const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const storageState = {
  settings: {
    agentBaseUrl: "http://127.0.0.1:4318",
    playwrightEnabled: true,
    exportSchemaVersion: 10
  },
  latestAgentJob: {
    id: "11111111-1111-4111-8111-111111111111",
    status: "running",
    processed: 54,
    total: 102,
    message: "Working"
  },
  latestRows: [{ websiteName: "Already saved", websiteUrl: "https://saved.example/" }]
};

let messageListener = null;
let fetchMode = "captcha";
let badgeText = "";
let badgeColor = "";
let alarmCleared = false;

function selectedStorage(keys) {
  if (typeof keys === "string") {
    return { [keys]: storageState[keys] };
  }
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map((key) => [key, storageState[key]]));
  }
  return { ...keys, ...storageState };
}

const chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener(listener) { messageListener = listener; } }
  },
  storage: {
    local: {
      async get(keys) { return selectedStorage(keys); },
      async set(values) { Object.assign(storageState, values); },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          delete storageState[key];
        }
      }
    }
  },
  alarms: {
    onAlarm: { addListener() {} },
    async create() {},
    async clear() { alarmCleared = true; }
  },
  action: {
    async setBadgeText(options) { badgeText = options.text; },
    async setBadgeBackgroundColor(options) { badgeColor = options.color; }
  }
};

const sandbox = {
  chrome,
  URL,
  console,
  setTimeout,
  clearTimeout,
  fetch: async () => {
    if (fetchMode === "offline") {
      throw new Error("agent stopped");
    }
    return {
      ok: true,
      async json() {
        return {
          id: storageState.latestAgentJob.id,
          status: "waiting_captcha",
          processed: 55,
          total: 102,
          message: "Solve CAPTCHA",
          rows: [{ websiteName: "Fresh snapshot", websiteUrl: "https://fresh.example/" }]
        };
      }
    };
  }
};

vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "../src/background/service-worker.js"), "utf8"),
  sandbox
);

function send(message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("service worker response timed out")), 2000);
    const keepChannelOpen = messageListener(message, {}, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
    assert.equal(keepChannelOpen, true);
  });
}

(async () => {
  const captchaJob = await send({ type: "GET_PLAYWRIGHT_JOB" });
  assert.equal(captchaJob.status, "waiting_captcha");
  assert.equal(captchaJob.processed, 55);
  assert.equal(badgeText, "IN");
  assert.equal(badgeColor, "#0b7fab");
  assert.equal(storageState.latestRows[0].websiteName, "Fresh snapshot");

  storageState.latestAgentJob = {
    ...storageState.latestAgentJob,
    status: "running",
    processed: 55,
    total: 102
  };
  fetchMode = "offline";
  const partialJob = await send({ type: "GET_PLAYWRIGHT_JOB" });
  assert.equal(partialJob.status, "partial");
  assert.equal(badgeText, "OK");
  assert.equal(badgeColor, "#16815d");
  assert.equal(alarmCleared, true);
  assert.equal(storageState.latestRows[0].websiteName, "Fresh snapshot");
  assert.match(partialJob.message, /55\/102/);

  console.log("Service worker partial-job tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
