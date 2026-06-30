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

const fields = {
  maxScrolls: document.getElementById("maxScrolls"),
  scrollDelayMs: document.getElementById("scrollDelayMs"),
  playwrightEnabled: document.getElementById("playwrightEnabled"),
  agentBaseUrl: document.getElementById("agentBaseUrl"),
  openChatGPTLogin: document.getElementById("openChatGPTLogin"),
  dedupe: document.getElementById("dedupe"),
  startFromTop: document.getElementById("startFromTop"),
  restoreScroll: document.getElementById("restoreScroll"),
  status: document.getElementById("status"),
  form: document.getElementById("settingsForm"),
  reset: document.getElementById("reset")
};

init();

async function init() {
  const stored = await chrome.storage.local.get(["settings"]);
  renderSettings({
    ...DEFAULT_SETTINGS,
    ...(stored.settings || {})
  });
  fields.form.addEventListener("submit", save);
  fields.reset.addEventListener("click", reset);
  fields.openChatGPTLogin.addEventListener("click", openChatGPTLogin);
}

function renderSettings(settings) {
  fields.maxScrolls.value = settings.maxScrolls;
  fields.scrollDelayMs.value = settings.scrollDelayMs;
  fields.playwrightEnabled.checked = settings.playwrightEnabled !== false;
  fields.agentBaseUrl.value = settings.agentBaseUrl || DEFAULT_SETTINGS.agentBaseUrl;
  fields.dedupe.checked = settings.dedupe !== false;
  fields.startFromTop.checked = settings.startFromTop !== false;
  fields.restoreScroll.checked = settings.restoreScroll !== false;
}

function readSettings() {
  return {
    companySource: "consignee",
    maxScrolls: clamp(Number(fields.maxScrolls.value) || DEFAULT_SETTINGS.maxScrolls, 5, 500),
    scrollDelayMs: clamp(Number(fields.scrollDelayMs.value) || DEFAULT_SETTINGS.scrollDelayMs, 100, 2500),
    playwrightEnabled: fields.playwrightEnabled.checked,
    agentBaseUrl: fields.agentBaseUrl.value.trim().replace(/\/+$/, "") || DEFAULT_SETTINGS.agentBaseUrl,
    dedupe: fields.dedupe.checked,
    startFromTop: fields.startFromTop.checked,
    restoreScroll: fields.restoreScroll.checked,
    directWindowCount: DEFAULT_SETTINGS.directWindowCount,
    directMaxPages: DEFAULT_SETTINGS.directMaxPages,
    exportSchemaVersion: DEFAULT_SETTINGS.exportSchemaVersion
  };
}

async function save(event) {
  event.preventDefault();
  await chrome.storage.local.set({ settings: readSettings() });
  fields.status.textContent = "Saved";
}

async function reset() {
  renderSettings(DEFAULT_SETTINGS);
  await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  fields.status.textContent = "Reset";
}

async function openChatGPTLogin() {
  await chrome.storage.local.set({ settings: readSettings() });
  fields.status.textContent = "Opening...";
  const response = await chrome.runtime.sendMessage({ type: "OPEN_CHATGPT_LOGIN" });
  fields.status.textContent = response?.error || "Gemini login opened";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
