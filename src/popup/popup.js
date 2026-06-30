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

const STORAGE_ROW_KEYS = [
  "hsCode",
  "websiteName",
  "websiteUrl",
  "email",
  "phone",
  "companyName",
  "consignee",
  "consigneeUrl",
  "country",
  "duplicateCount",
  "contactSource",
  "reviewStatus",
  "sourceMethod",
  "capturedAt"
];
const MAX_RAW_ROWS_STORAGE_BYTES = 2 * 1024 * 1024;

const state = {
  rows: [],
  rawRows: [],
  columns: window.EximProcessor.columns,
  duplicatesRemoved: 0,
  diagnostics: [],
  settings: { ...DEFAULT_SETTINGS }
};

function compactRowsForStorage(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map((row) => {
    const compact = {};
    for (const key of STORAGE_ROW_KEYS) {
      if (row?.[key] !== undefined && row[key] !== null && row[key] !== "") {
        compact[key] = row[key];
      }
    }
    return compact;
  });
}

function jsonStorageBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value || null)).length;
}

async function safeStorageSet(values) {
  try {
    await chrome.storage.local.set(values);
    return true;
  } catch (error) {
    if (!/quota|storage/i.test(String(error?.message || error))) {
      throw error;
    }
    const fallback = { ...values };
    if (Array.isArray(fallback.latestRows)) {
      fallback.latestRows = compactRowsForStorage(fallback.latestRows);
    }
    delete fallback.latestRawRows;
    delete fallback.latestDiagnostics;
    await chrome.storage.local.remove(["latestRawRows", "latestDiagnostics"]);
    await chrome.storage.local.set(fallback);
    return false;
  }
}

const els = {
  pageStatus: document.getElementById("pageStatus"),
  activity: document.getElementById("activity"),
  duplicateInfo: document.getElementById("duplicateInfo"),
  totalRows: document.getElementById("totalRows"),
  websiteRows: document.getElementById("websiteRows"),
  emailRows: document.getElementById("emailRows"),
  phoneRows: document.getElementById("phoneRows"),
  previewRows: document.getElementById("previewRows"),
  maxScrolls: document.getElementById("maxScrolls"),
  dedupe: document.getElementById("dedupe"),
  startFromTop: document.getElementById("startFromTop"),
  captureVisible: document.getElementById("captureVisible"),
  captureAll: document.getElementById("captureAll"),
  enrichContacts: document.getElementById("enrichContacts"),
  exportCsv: document.getElementById("exportCsv"),
  exportExcel: document.getElementById("exportExcel"),
  openOptions: document.getElementById("openOptions"),
  busyOverlay: document.getElementById("busyOverlay"),
  busyTitle: document.getElementById("busyTitle"),
  busyDetail: document.getElementById("busyDetail")
};

init();

async function init() {
  await loadSettings();
  await loadCachedRows();
  bindEvents();
  setButtons();
  render();
  await refreshPageStatus();
  try {
    await resumeAgentJob();
  } catch (error) {
    showError(error);
  }
}

function bindEvents() {
  els.maxScrolls.addEventListener("change", updateSettingsFromForm);
  els.dedupe.addEventListener("change", updateSettingsFromForm);
  els.startFromTop.addEventListener("change", updateSettingsFromForm);
  els.captureVisible.addEventListener("click", () => capture("visible"));
  els.captureAll.addEventListener("click", () => capture("all"));
  els.enrichContacts.addEventListener("click", enrichContacts);
  els.exportCsv.addEventListener("click", () => exportRows("csv"));
  els.exportExcel.addEventListener("click", () => exportRows("xlsx"));
  els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(["settings"]);
  const storedSettings = stored.settings || {};
  state.settings = {
    ...DEFAULT_SETTINGS,
    ...storedSettings
  };
  if (storedSettings.exportSchemaVersion !== DEFAULT_SETTINGS.exportSchemaVersion) {
    state.settings.dedupe = true;
    state.settings.playwrightEnabled = true;
    state.settings.agentBaseUrl = DEFAULT_SETTINGS.agentBaseUrl;
    state.settings.exportSchemaVersion = DEFAULT_SETTINGS.exportSchemaVersion;
    await chrome.storage.local.set({ settings: state.settings });
  }
  els.maxScrolls.value = state.settings.maxScrolls;
  els.dedupe.checked = state.settings.dedupe !== false;
  els.startFromTop.checked = state.settings.startFromTop !== false;
}

async function loadCachedRows() {
  const stored = await chrome.storage.local.get(["latestRows", "latestRawRows", "latestDuplicatesRemoved", "latestDiagnostics", "latestSchemaVersion"]);
  if (stored.latestSchemaVersion !== DEFAULT_SETTINGS.exportSchemaVersion) {
    state.rows = [];
    state.rawRows = [];
    state.duplicatesRemoved = 0;
    state.diagnostics = [];
    await chrome.storage.local.remove(["latestRows", "latestRawRows", "latestDuplicatesRemoved", "latestDiagnostics"]);
    return;
  }
  state.rows = Array.isArray(stored.latestRows) ? stored.latestRows : [];
  state.rawRows = Array.isArray(stored.latestRawRows) ? stored.latestRawRows : [];
  state.duplicatesRemoved = Number(stored.latestDuplicatesRemoved || 0);
  state.diagnostics = Array.isArray(stored.latestDiagnostics) ? stored.latestDiagnostics : [];
}

async function updateSettingsFromForm() {
  state.settings = {
    ...state.settings,
    companySource: "consignee",
    maxScrolls: Math.max(5, Math.min(500, Number(els.maxScrolls.value) || DEFAULT_SETTINGS.maxScrolls)),
    dedupe: els.dedupe.checked,
    startFromTop: els.startFromTop.checked,
    playwrightEnabled: state.settings.playwrightEnabled !== false,
    agentBaseUrl: state.settings.agentBaseUrl || DEFAULT_SETTINGS.agentBaseUrl
  };
  await chrome.storage.local.set({ settings: state.settings });
  if (state.rawRows.length) {
    processAndStore(state.rawRows);
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }
  return tab;
}

function isAllowedReportUrl(url) {
  try {
    const parsed = new URL(url || "");
    return parsed.hostname === "eximelite.com"
      || parsed.hostname.endsWith(".eximelite.com")
      || parsed.hostname === "app.powerbi.com"
      || parsed.hostname.endsWith(".powerbi.com");
  } catch (error) {
    return false;
  }
}

async function refreshPageStatus() {
  try {
    const tab = await activeTab();
    const url = new URL(tab.url || "");
    els.pageStatus.textContent = url.hostname || "Current tab";
  } catch (error) {
    els.pageStatus.textContent = "Current tab unavailable";
  }
}

function setBusy(isBusy, message = "Working", detail = "You may switch tabs; the local agent keeps running.") {
  document.body.classList.toggle("busy-lock", Boolean(isBusy));
  for (const button of [els.captureVisible, els.captureAll, els.enrichContacts, els.exportCsv, els.exportExcel]) {
    button.disabled = isBusy;
  }
  if (isBusy) {
    els.activity.textContent = message;
    els.busyTitle.textContent = message;
    els.busyDetail.textContent = detail;
    els.busyOverlay.hidden = false;
  } else {
    els.busyOverlay.hidden = true;
  }
}

function setButtons() {
  const hasRows = state.rows.length > 0;
  els.enrichContacts.disabled = !hasRows;
  els.exportCsv.disabled = !hasRows;
  els.exportExcel.disabled = !hasRows;
}

async function capture(mode) {
  const isFullCapture = mode === "all";
  setBusy(
    true,
    isFullCapture ? "Preparing capture" : "Reading report",
    isFullCapture ? "Rows will be captured first, then the Playwright Gemini agent will fill contacts." : "Reading visible table rows."
  );
  try {
    await updateSettingsFromForm();
    const tab = await activeTab();
    if (!isAllowedReportUrl(tab.url)) {
      throw new Error("Use this extension only on EXIM Elite / Power BI report pages.");
    }
    setBusy(true, isFullCapture ? "Requesting Power BI data" : "Reading report", "Collecting rows from the report table.");
    await installPowerBiNetworkCapture(tab.id, { resetResponses: true, resetRequests: false });

    let directCapture = emptyDirectCapture();
    let frameResults = [];
    let networkCapture = emptyNetworkCapture();

    if (isFullCapture) {
      directCapture = await replayPowerBiQuery(tab.id, state.settings);
    }

    if (isFullCapture && directCapture.rows.length) {
      setBusy(true, "Matching table links", "Reading clickable consignee/exporter links from the report.");
      try {
        frameResults = await captureDomRows(tab.id, "all", state.settings);
      } catch (error) {
        directCapture.errors.push(`Table link matching skipped: ${error?.message || error}`);
      }
    }

    if (!isFullCapture || !directCapture.rows.length) {
      setBusy(
        true,
        isFullCapture ? "Using table fallback" : "Reading report",
        isFullCapture ? "Direct query was not ready, so the extension is scrolling the report table." : "Reading visible table rows."
      );
      frameResults = await captureDomRows(tab.id, mode, state.settings);
      await sleep(600);
      networkCapture = await collectPowerBiNetworkCapture(tab.id);
    }

    const domRows = frameResults.flatMap((result) => Array.isArray(result.rows) ? result.rows : []);
    const networkRows = directCapture.rows.length ? mergeLinkRows(directCapture.rows, domRows) : networkCapture.rows;
    const rawRows = networkRows.length ? networkRows : domRows;

    if (directCapture.rows.length) {
      state.diagnostics = [{
        href: tab.url,
        rowCount: directCapture.rows.length,
        strategy: "powerbi-direct-querydata",
        diagnostics: {
          directPages: directCapture.pages,
          directResponses: directCapture.responses,
          directWindowCount: directCapture.directWindowCount,
          restartTokens: directCapture.restartTokens.length,
          matchedLinkRows: domRows.filter((row) => row.consigneeUrl || row.exporterUrl).length,
          requestFields: directCapture.fields
        }
      }];
    } else {
      state.diagnostics = frameResults.map((result) => ({
        href: result.href,
        frameElement: result.frameElement,
        rowCount: result.rowCount || 0,
        strategy: result.strategy || "none",
        diagnostics: result.diagnostics || {}
      }));
    }

    await processAndStore(rawRows);
    const frames = frameResults.filter((result) => result.ok).length;
    const powerBiFrames = state.diagnostics.filter((item) => item.diagnostics?.isPowerBi).length;
    const methods = [...new Set(state.rows.map((row) => row.sourceMethod).filter(Boolean))].slice(0, 3).join(", ");
    const fieldNote = contactFieldsAvailable(directCapture.fields.length ? directCapture.fields : networkCapture.fields)
      ? ""
      : ", no contact fields in query";
    const captureMessage = state.rows.length
      ? activityText({
        directCapture,
        networkCapture,
        frames,
        methods,
        fieldNote
      })
      : `0 rows, ${frames} frame(s), Power BI frames ${powerBiFrames}`;
    els.activity.textContent = captureMessage;

    if (isFullCapture && state.rows.length) {
      const enriched = await enrichCurrentRows({
        startMessage: "Starting Playwright agent",
        startDetail: "Google result links and Gemini JSON continue even if this popup closes."
      });
      els.activity.textContent = enriched.ran
        ? enriched.message
        : `${captureMessage}; ${enriched.message}`;
    }
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
    setButtons();
  }
}

async function captureDomRows(tabId, mode, settings) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["src/content/extractor.js"]
  });

  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    args: [mode, settings],
    func: async (captureMode, captureSettings) => {
      if (!window.__EXIM_ELITE_EXTRACTOR__) {
        return { ok: false, error: "Extractor unavailable in this frame", rows: [] };
      }
      if (captureMode === "all") {
        return await window.__EXIM_ELITE_EXTRACTOR__.captureWithScroll(captureSettings);
      }
      return window.__EXIM_ELITE_EXTRACTOR__.captureVisible();
    }
  });

  return results.map((item) => item.result).filter(Boolean);
}

function linkKeyPart(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function makeLinkKey(row, fields) {
  return fields.map((field) => linkKeyPart(row?.[field])).join("|");
}

function buildLinkLookup(rows, fields) {
  const lookup = new Map();
  for (const row of rows || []) {
    if (!row?.consigneeUrl && !row?.exporterUrl) {
      continue;
    }
    const key = makeLinkKey(row, fields);
    if (key.replace(/\|/g, "").trim() && !lookup.has(key)) {
      lookup.set(key, row);
    }
  }
  return lookup;
}

function mergeLinkRows(primaryRows, linkRows) {
  if (!primaryRows.length || !linkRows.length) {
    return primaryRows;
  }

  const keySets = [
    ["hsCode", "consignee", "exporter", "country", "quantity", "fobValue"],
    ["hsCode", "consignee", "exporter", "country", "fobValue"],
    ["hsCode", "consignee", "exporter", "country", "quantity"],
    ["hsCode", "consignee", "exporter", "country"],
    ["consignee", "country"],
    ["consignee"]
  ];
  const lookups = keySets.map((fields) => ({ fields, lookup: buildLinkLookup(linkRows, fields) }));

  return primaryRows.map((row) => {
    const match = lookups
      .map(({ fields, lookup }) => lookup.get(makeLinkKey(row, fields)))
      .find(Boolean);

    if (!match) {
      return row;
    }
    return {
      ...row,
      consigneeUrl: row.consigneeUrl || match.consigneeUrl || "",
      exporterUrl: row.exporterUrl || match.exporterUrl || ""
    };
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyDirectCapture() {
  return {
    rows: [],
    responses: 0,
    pages: 0,
    restartTokens: [],
    fields: [],
    errors: [],
    requests: 0,
    directWindowCount: 0,
    hasMore: false
  };
}

function emptyNetworkCapture() {
  return {
    rows: [],
    responses: 0,
    restartTokens: [],
    fields: [],
    requests: 0
  };
}

function activityText({ directCapture, networkCapture, frames, methods, fieldNote }) {
  if (directCapture.rows.length) {
    const moreNote = directCapture.hasMore ? ", more token present" : "";
    return `${state.rows.length} rows, direct Power BI API, ${directCapture.pages} page(s)${moreNote}${fieldNote}`;
  }
  if (networkCapture.rows.length) {
    return `${state.rows.length} rows, ${networkCapture.responses} Power BI response(s)${fieldNote}`;
  }
  return `${state.rows.length} rows, ${frames} frame(s), ${methods || "captured"}${fieldNote}`;
}

function contactFieldsAvailable(fields) {
  return (fields || []).some((field) => /\b(?:email|phone|mobile|website|web site|contact)\b/i.test(field));
}

async function installPowerBiNetworkCapture(tabId, options = {}) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "MAIN",
    files: ["src/content/powerbi-capture-main.js"]
  });

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "MAIN",
    args: [options],
    func: (resetOptions) => {
      const capture = window.__EXIM_ELITE_PBI_CAPTURE__;
      if (!capture?.installed) {
        return { ok: false, error: "Power BI capture script unavailable" };
      }
      if (capture.reset) {
        return capture.reset({
          responses: resetOptions?.resetResponses !== false,
          requests: resetOptions?.resetRequests === true
        });
      }
      if (resetOptions?.resetResponses !== false) {
        capture.responses = [];
      }
      return {
        ok: true,
        installed: true,
        responses: Array.isArray(capture.responses) ? capture.responses.length : 0,
        requests: Array.isArray(capture.requests) ? capture.requests.length : 0
      };
    }
  });
}

async function replayPowerBiQuery(tabId, settings) {
  const output = emptyDirectCapture();
  const requestState = await collectPowerBiRequestState(tabId);
  output.fields = requestState.fields;
  output.requests = requestState.requests;
  output.directWindowCount = Math.max(500, Math.min(100000, Number(settings.directWindowCount) || DEFAULT_SETTINGS.directWindowCount));

  if (!requestState.requests) {
    output.errors.push("No Power BI query request captured yet.");
    return output;
  }

  const maxPages = Math.max(1, Math.min(10, Number(settings.directMaxPages) || DEFAULT_SETTINGS.directMaxPages));
  const seenBodies = new Set();
  const seenPageSignatures = new Set();
  let restartToken = null;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await replayPowerBiQueryPage(tabId, {
      count: output.directWindowCount,
      restartToken,
      tokenMode: "full"
    });
    let accepted = addDirectPage(output, page, seenBodies, seenPageSignatures);

    if (!accepted && restartToken) {
      const valueTokenPage = await replayPowerBiQueryPage(tabId, {
        count: output.directWindowCount,
        restartToken,
        tokenMode: "values"
      });
      accepted = addDirectPage(output, valueTokenPage, seenBodies, seenPageSignatures);
    }

    if (!accepted) {
      break;
    }

    restartToken = output.restartTokens[output.restartTokens.length - 1] || null;
    output.hasMore = Boolean(restartToken);
    if (!restartToken) {
      break;
    }
  }

  return output;
}

function addDirectPage(output, pageResults, seenBodies, seenPageSignatures) {
  const candidates = pageResults.filter((result) => result?.body);
  if (!candidates.length) {
    output.errors.push(...pageResults.map((result) => result?.error).filter(Boolean));
    return false;
  }

  for (const candidate of candidates) {
    const bodyKey = candidate.body;
    if (seenBodies.has(bodyKey)) {
      continue;
    }
    seenBodies.add(bodyKey);
    const parsed = window.EximPowerBiDsr.parseResponses([{ body: candidate.body }]);
    if (!parsed.rows.length) {
      output.errors.push(candidate.error || `Power BI response ${candidate.status || ""} returned no rows`.trim());
      continue;
    }

    const signature = pageSignature(parsed.rows);
    if (seenPageSignatures.has(signature)) {
      output.errors.push("Power BI returned a duplicate page; direct paging stopped.");
      return false;
    }

    seenPageSignatures.add(signature);
    output.rows.push(...parsed.rows);
    output.restartTokens.push(...parsed.restartTokens);
    output.responses += parsed.parsedResponses;
    output.pages += 1;
    return true;
  }

  return false;
}

function pageSignature(rows) {
  const first = rows[0] || {};
  const last = rows[rows.length - 1] || {};
  return [rows.length, rowSignature(first), rowSignature(last)].join("::");
}

function rowSignature(row) {
  return [
    row.hsCode,
    row.consignee,
    row.exporter,
    row.productDescription,
    row.country,
    row.quantity,
    row.fobValue
  ].map((value) => String(value || "").toLowerCase()).join("|");
}

async function replayPowerBiQueryPage(tabId, options) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "MAIN",
    args: [options],
    func: async (replayOptions) => {
      const capture = window.__EXIM_ELITE_PBI_CAPTURE__;
      if (!capture?.replayLatest) {
        return {
          ok: false,
          error: "Power BI capture script unavailable",
          href: window.location.href
        };
      }
      return await capture.replayLatest(replayOptions);
    }
  });

  return results.map((item) => item.result).filter(Boolean);
}

function isReportTableRequest(request) {
  const body = String(request?.body || "").toLowerCase();
  return body.includes("hs code")
    && body.includes("consignee")
    && (body.includes("expoerter") || body.includes("exporter"))
    && body.includes("product description");
}

function selectPowerBiTableRequest(requests) {
  const candidates = [...(requests || [])].reverse().filter((request) => request?.body);
  return candidates.find(isReportTableRequest) || candidates[0] || null;
}

async function collectPowerBiRequestState(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "MAIN",
    func: () => {
      const capture = window.__EXIM_ELITE_PBI_CAPTURE__;
      return {
        href: window.location.href,
        requests: Array.isArray(capture?.requests) ? capture.requests.map((request) => ({
          url: request.url,
          body: request.body,
          capturedAt: request.capturedAt,
          kind: request.kind
        })) : []
      };
    }
  });

  const requests = results
    .map((item) => item.result)
    .filter(Boolean)
    .flatMap((item) => Array.isArray(item.requests) ? item.requests : []);
  const latestRequest = selectPowerBiTableRequest(requests);
  return {
    requests: requests.length,
    fields: uniqueFields(window.EximPowerBiDsr.requestFieldNames(latestRequest?.body || ""))
  };
}

async function collectPowerBiNetworkCapture(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "MAIN",
    func: () => {
      const capture = window.__EXIM_ELITE_PBI_CAPTURE__;
      return {
        href: window.location.href,
        responses: Array.isArray(capture?.responses) ? capture.responses : [],
        requests: Array.isArray(capture?.requests) ? capture.requests.map((request) => ({
          url: request.url,
          body: request.body,
          capturedAt: request.capturedAt,
          kind: request.kind
        })) : []
      };
    }
  });

  const responses = results
    .map((item) => item.result)
    .filter(Boolean)
    .flatMap((item) => Array.isArray(item.responses) ? item.responses : []);
  const requests = results
    .map((item) => item.result)
    .filter(Boolean)
    .flatMap((item) => Array.isArray(item.requests) ? item.requests : []);
  const latestRequest = selectPowerBiTableRequest(requests);
  const parsed = window.EximPowerBiDsr.parseResponses(responses);
  return {
    rows: parsed.rows,
    responses: parsed.parsedResponses,
    restartTokens: parsed.restartTokens,
    fields: uniqueFields(window.EximPowerBiDsr.requestFieldNames(latestRequest?.body || "")),
    requests: requests.length
  };
}

function uniqueFields(fields) {
  const seen = new Set();
  const output = [];
  for (const field of fields || []) {
    const key = String(field || "").toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(field);
  }
  return output;
}

async function processAndStore(rawRows) {
  const processed = window.EximProcessor.processRows(rawRows, state.settings);
  state.rawRows = rawRows;
  state.rows = processed.rows;
  state.columns = processed.columns;
  state.duplicatesRemoved = processed.duplicatesRemoved;
  const rawRowsForStorage = jsonStorageBytes(rawRows) <= MAX_RAW_ROWS_STORAGE_BYTES ? state.rawRows : [];
  await safeStorageSet({
    latestRows: compactRowsForStorage(state.rows),
    latestRawRows: rawRowsForStorage,
    latestDuplicatesRemoved: state.duplicatesRemoved,
    latestDiagnostics: state.diagnostics,
    latestSchemaVersion: DEFAULT_SETTINGS.exportSchemaVersion
  });
  render();
}

async function saveLatestRows(rows, shouldRender = true) {
  if (!Array.isArray(rows)) {
    return;
  }
  state.rows = rows;
  await safeStorageSet({
    latestRows: compactRowsForStorage(state.rows),
    latestSchemaVersion: DEFAULT_SETTINGS.exportSchemaVersion
  });
  if (shouldRender) {
    render();
  }
}

async function refreshLatestRowsFromStorage() {
  const stored = await chrome.storage.local.get(["latestRows", "latestSchemaVersion"]);
  if (
    stored.latestSchemaVersion === DEFAULT_SETTINGS.exportSchemaVersion
    && Array.isArray(stored.latestRows)
    && stored.latestRows.length
  ) {
    state.rows = stored.latestRows;
    render();
  }
}

async function enrichContacts() {
  if (!state.rows.length) {
    return;
  }

  setBusy(true, "Starting Playwright agent", "Google result links and Gemini JSON continue even if this popup closes.");
  try {
    const enriched = await enrichCurrentRows({});
    els.activity.textContent = enriched.message;
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
    setButtons();
  }
}

async function enrichCurrentRows(options = {}) {
  if (!state.rows.length) {
    return { ran: false, message: "No rows captured" };
  }

  if (state.settings.playwrightEnabled === false) {
    return { ran: false, message: "Enable Playwright agent in Settings" };
  }

  setBusy(
    true,
    options.startMessage || "Starting Playwright agent",
    options.startDetail || "Google result links and Gemini JSON continue even if this popup closes."
  );
  const job = await chrome.runtime.sendMessage({
    type: "START_PLAYWRIGHT_JOB",
    rows: state.rows
  });
  if (job?.error) {
    throw new Error(job.error);
  }
  const completed = await watchAgentJob(job);
  return { ran: true, message: agentLookupMessage(completed) };
}

async function resumeAgentJob() {
  const stored = await chrome.storage.local.get(["latestAgentJob"]);
  const job = stored.latestAgentJob;
  if (!job?.id) {
    return;
  }
  if (["queued", "running", "waiting_login", "waiting_captcha"].includes(job.status)) {
    try {
      const completed = await watchAgentJob(job);
      if (["completed", "partial"].includes(completed?.status)) {
        els.activity.textContent = agentLookupMessage(completed);
      }
    } finally {
      setBusy(false);
      setButtons();
    }
  } else if (["completed", "partial"].includes(job.status)) {
    await loadCompletedAgentRows();
    els.activity.textContent = agentLookupMessage(job);
  }
}

async function watchAgentJob(initialJob) {
  let job = initialJob;
  while (job && !["completed", "partial", "failed"].includes(job.status)) {
    const storedCompleted = await terminalAgentJobFromStorage(job.id);
    if (storedCompleted) {
      job = storedCompleted;
      break;
    }
    const progress = job.total ? `${job.processed || 0}/${job.total}` : "";
    setBusy(
      true,
      job.status === "waiting_captcha"
        ? "CAPTCHA solve required"
        : (job.status === "waiting_login" ? "Gemini login required" : `Playwright working ${progress}`.trim()),
      job.message || job.company || "Google result links and Gemini JSON processing."
    );
    const nearDone = Number(job.total || 0) > 0 && Number(job.processed || 0) >= Number(job.total || 0) - 1;
    await sleep(nearDone ? 400 : 1500);
    try {
      job = await chrome.runtime.sendMessage({ type: "GET_PLAYWRIGHT_JOB" });
    } catch (error) {
      const stopped = await markAgentJobStoppedFromStorage(initialJob.id, error?.message || String(error));
      if (stopped) {
        job = stopped;
        break;
      }
      throw error;
    }
    if (!job) {
      const stopped = await markAgentJobStoppedFromStorage(initialJob.id, "No response from the extension background worker");
      if (stopped) {
        job = stopped;
        break;
      }
      throw new Error("No response from the extension background worker");
    }
    if (job?.error) {
      const completedAfterError = await terminalAgentJobFromStorage(initialJob.id);
      if (completedAfterError) {
        job = completedAfterError;
        break;
      }
      const stopped = await markAgentJobStoppedFromStorage(initialJob.id, job.error);
      if (stopped) {
        job = stopped;
        break;
      }
      throw new Error(job.error);
    }
    if (Array.isArray(job.rows)) {
      await saveLatestRows(job.rows);
    }
  }
  if (job?.status === "failed") {
    throw new Error(job.error || job.message || "Playwright Gemini job failed");
  }
  if (["completed", "partial"].includes(job?.status) && Array.isArray(job.rows)) {
    await saveLatestRows(job.rows);
  }
  if (["completed", "partial"].includes(job?.status)) {
    await loadCompletedAgentRows();
  }
  return job;
}

async function markAgentJobStoppedFromStorage(jobId, reason) {
  const stored = await chrome.storage.local.get(["latestAgentJob", "latestRows"]);
  const job = stored.latestAgentJob;
  if (job?.id !== jobId) {
    return null;
  }
  if (["completed", "partial"].includes(job.status)) {
    return agentJobWithStoredRows(job, stored.latestRows);
  }
  const partial = {
    ...job,
    status: "partial",
    updatedAt: new Date().toISOString(),
    error: "",
    message: `Playwright agent stopped after ${Number(job.processed || 0)}/${Number(job.total || 0)} results. Showing saved data.`,
    stopReason: reason
  };
  const storageUpdate = { latestAgentJob: partial };
  if (Array.isArray(stored.latestRows)) {
    storageUpdate.latestRows = stored.latestRows;
    storageUpdate.latestSchemaVersion = DEFAULT_SETTINGS.exportSchemaVersion;
  }
  await chrome.storage.local.set(storageUpdate);
  return agentJobWithStoredRows(partial, stored.latestRows);
}

async function terminalAgentJobFromStorage(jobId) {
  const stored = await chrome.storage.local.get(["latestAgentJob", "latestRows"]);
  const job = stored.latestAgentJob;
  if (job?.id !== jobId || !["completed", "partial"].includes(job.status)) {
    return null;
  }
  return agentJobWithStoredRows(job, stored.latestRows);
}

function agentJobWithStoredRows(job, rows) {
  if (Array.isArray(rows)) {
    state.rows = rows;
    render();
    return { ...job, rows };
  }
  return job;
}

async function loadCompletedAgentRows() {
  await refreshLatestRowsFromStorage();
}

function agentLookupMessage(job) {
  const rows = Array.isArray(job?.rows) ? job.rows : state.rows;
  const info = window.EximProcessor.summary(rows, state.duplicatesRemoved);
  if (info.withWebsite || info.withEmail || info.withPhone) {
    const prefix = job?.status === "partial"
      ? `Agent stopped at ${Number(job.processed || 0)}/${Number(job.total || 0)}; saved`
      : "Playwright complete";
    return `${prefix}: ${info.withWebsite} website, ${info.withEmail} email, ${info.withPhone} phone`;
  }
  return job?.status === "partial"
    ? `Agent stopped at ${Number(job.processed || 0)}/${Number(job.total || 0)}; saved rows are ready`
    : "Playwright complete: no first-result contact found";
}

function compactMessage(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 110 ? `${text.slice(0, 107)}...` : text;
}

async function exportRows(format) {
  await refreshLatestRowsFromStorage();
  if (!state.rows.length) {
    return;
  }

  setBusy(true, format === "csv" ? "Preparing CSV" : "Preparing Excel");
  try {
    if (format === "csv") {
      const blob = window.EximExporter.toCsvBlob(state.rows, state.columns);
      await window.EximExporter.downloadBlob(blob, window.EximExporter.exportFilename("csv"));
    } else {
      const blob = window.EximExporter.toXlsxBlob(state.rows, state.columns);
      await window.EximExporter.downloadBlob(blob, window.EximExporter.exportFilename("xlsx"));
    }
    els.activity.textContent = "Download started";
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
    setButtons();
  }
}

function render() {
  const info = window.EximProcessor.summary(state.rows, state.duplicatesRemoved);
  els.totalRows.textContent = String(info.total);
  els.websiteRows.textContent = String(info.withWebsite);
  els.emailRows.textContent = String(info.withEmail);
  els.phoneRows.textContent = String(info.withPhone);
  els.duplicateInfo.textContent = `Duplicates removed: ${info.duplicatesRemoved}`;

  if (!state.rows.length) {
    els.previewRows.innerHTML = '<tr><td colspan="5" class="empty">No rows captured</td></tr>';
    setButtons();
    return;
  }

  els.previewRows.innerHTML = state.rows.slice(0, 80).map((row) => `
    <tr>
      <td title="${html(row.hsCode)}">${html(row.hsCode)}</td>
      <td title="${html(row.websiteName)}">${html(row.websiteName || "-")}</td>
      <td title="${html(row.websiteUrl)}">${html(row.websiteUrl || "-")}</td>
      <td title="${html(row.email)}">${html(row.email || "-")}</td>
      <td title="${html(row.phone)}">${html(row.phone || "-")}</td>
    </tr>
  `).join("");
  setButtons();
}

function html(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showError(error) {
  const message = error?.message || String(error);
  els.activity.textContent = message.slice(0, 80);
  console.error(error);
}
