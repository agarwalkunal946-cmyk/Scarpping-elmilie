const DEFAULT_SETTINGS = {
  companySource: "consignee",
  dedupe: true,
  maxScrolls: 150,
  scrollDelayMs: 280,
  startFromTop: true,
  restoreScroll: true,
  directWindowCount: 50000,
  directMaxPages: 4,
  playwrightEnabled: true,
  agentBaseUrl: "http://127.0.0.1:4318",
  exportSchemaVersion: 10
};

const POLL_ALARM = "exim-playwright-job";
const TERMINAL_JOB_STATUSES = ["completed", "partial", "failed"];

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(["settings", "installedAt"]);
  const existingSettings = existing.settings || {};
  const nextSettings = {
    ...DEFAULT_SETTINGS,
    ...existingSettings
  };
  const schemaChanged = existingSettings.exportSchemaVersion !== DEFAULT_SETTINGS.exportSchemaVersion;
  if (schemaChanged) {
    nextSettings.companySource = "consignee";
    nextSettings.dedupe = true;
    nextSettings.playwrightEnabled = existingSettings.playwrightEnabled !== false;
    nextSettings.agentBaseUrl = existingSettings.agentBaseUrl || DEFAULT_SETTINGS.agentBaseUrl;
    nextSettings.exportSchemaVersion = DEFAULT_SETTINGS.exportSchemaVersion;
    await chrome.storage.local.remove([
      "latestRows",
      "latestRawRows",
      "latestDuplicatesRemoved",
      "latestDiagnostics",
      "latestSchemaVersion",
      "latestAgentJob"
    ]);
  }
  await chrome.storage.local.set({
    installedAt: existing.installedAt || new Date().toISOString(),
    settings: nextSettings
  });
});

chrome.runtime.onStartup.addListener(() => {
  pollStoredJob().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    pollStoredJob().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "START_PLAYWRIGHT_JOB") {
    startJob(message.rows || []).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === "GET_PLAYWRIGHT_JOB") {
    pollStoredJob().then(sendResponse).catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === "PLAYWRIGHT_HEALTH") {
    agentRequest("/health").then(sendResponse).catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === "OPEN_GEMINI_LOGIN") {
    agentRequest("/auth/open", { method: "POST" }).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  return false;
});

async function settings() {
  const stored = await chrome.storage.local.get(["settings"]);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored.settings || {})
  };
}

async function agentRequest(path, init = {}) {
  const current = await settings();
  const base = String(current.agentBaseUrl || DEFAULT_SETTINGS.agentBaseUrl).replace(/\/+$/, "");
  let response;
  try {
    response = await fetch(base + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {})
      },
      cache: "no-store"
    });
  } catch (error) {
    throw new Error("Local Playwright agent is not running. Start it with: npm run agent");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Playwright agent HTTP ${response.status}`);
  }
  return body;
}

async function startJob(rows) {
  const current = await settings();
  if (current.playwrightEnabled === false) {
    throw new Error("Playwright agent is disabled in Settings");
  }
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("No captured rows to process");
  }
  const job = await agentRequest("/jobs", {
    method: "POST",
    body: JSON.stringify({ rows })
  });
  await chrome.storage.local.set({ latestAgentJob: jobMetadata(job) });
  await chrome.action.setBadgeBackgroundColor({ color: "#0b7fab" });
  await chrome.action.setBadgeText({ text: "AI" });
  await chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  return job;
}

async function pollStoredJob() {
  const stored = await chrome.storage.local.get(["latestAgentJob"]);
  const current = stored.latestAgentJob;
  if (!current?.id) {
    return current || null;
  }
  if (TERMINAL_JOB_STATUSES.includes(current.status)) {
    if (["completed", "partial"].includes(current.status)) {
      await chrome.action.setBadgeBackgroundColor({ color: "#16815d" });
      await chrome.action.setBadgeText({ text: "OK" });
    }
    return current;
  }
  let job;
  try {
    job = await agentRequest(`/jobs/${encodeURIComponent(current.id)}`);
  } catch (error) {
    return markStoredJobPartial(current, error?.message || String(error));
  }
  const metadata = jobMetadata(job);
  const storageUpdate = { latestAgentJob: metadata };
  if (Array.isArray(job.rows)) {
    storageUpdate.latestRows = job.rows;
    storageUpdate.latestSchemaVersion = DEFAULT_SETTINGS.exportSchemaVersion;
  }
  await chrome.storage.local.set(storageUpdate);
  if (["completed", "partial"].includes(job.status)) {
    await chrome.action.setBadgeBackgroundColor({ color: "#16815d" });
    await chrome.action.setBadgeText({ text: "OK" });
    await chrome.alarms.clear(POLL_ALARM);
  } else if (job.status === "failed") {
    await chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.alarms.clear(POLL_ALARM);
  } else {
    await chrome.action.setBadgeBackgroundColor({ color: "#0b7fab" });
    await chrome.action.setBadgeText({ text: ["waiting_login", "waiting_captcha"].includes(job.status) ? "IN" : "AI" });
  }
  return metadata;
}

async function markStoredJobPartial(job, message) {
  const partial = {
    ...job,
    status: "partial",
    updatedAt: new Date().toISOString(),
    error: "",
    message: `Playwright agent stopped after ${Number(job.processed || 0)}/${Number(job.total || 0)} results. Showing saved data.`,
    stopReason: message
  };
  await chrome.storage.local.set({ latestAgentJob: partial });
  await chrome.action.setBadgeBackgroundColor({ color: "#16815d" });
  await chrome.action.setBadgeText({ text: "OK" });
  await chrome.alarms.clear(POLL_ALARM);
  return partial;
}

function jobMetadata(job) {
  if (!job || typeof job !== "object") {
    return job;
  }
  const { rows, ...metadata } = job;
  return metadata;
}
