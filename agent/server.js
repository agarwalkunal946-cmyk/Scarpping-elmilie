const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { GeminiPlaywrightAgent, loadEnv } = require("./chatgpt-playwright");

loadEnv(path.resolve(process.cwd(), ".env"));

const port = Number(process.env.PLAYWRIGHT_AGENT_PORT || 4318);
const dataDir = path.resolve(process.cwd(), "agent-data");
const jobsDir = path.join(dataDir, "jobs");
const screenshotsDir = path.join(dataDir, "screenshots");
const jobs = new Map();
const queue = [];
const agent = new GeminiPlaywrightAgent();
let active = false;
let currentJob = null;
let shutdownStarted = false;

fs.mkdirSync(jobsDir, { recursive: true });
fs.mkdirSync(screenshotsDir, { recursive: true });

const artifactRetentionDays = Math.max(1, Math.floor(Number(process.env.AGENT_ARTIFACT_RETENTION_DAYS) || 7));
const artifactMaxJobs = Math.max(5, Math.floor(Number(process.env.AGENT_ARTIFACT_MAX_JOBS) || 20));

function cleanupArtifacts(protectedIds = new Set()) {
  const expiry = Date.now() - artifactRetentionDays * 24 * 60 * 60 * 1000;
  const records = fs.readdirSync(jobsDir)
    .filter((name) => /^[a-f0-9-]+\.json$/i.test(name))
    .map((name) => {
      const filePath = path.join(jobsDir, name);
      return { id: path.basename(name, ".json"), filePath, modifiedAt: fs.statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  records.forEach((record, index) => {
    if (protectedIds.has(record.id) || (index < artifactMaxJobs && record.modifiedAt >= expiry)) {
      return;
    }
    fs.rmSync(record.filePath, { force: true });
    fs.rmSync(path.join(screenshotsDir, record.id), { recursive: true, force: true });
    jobs.delete(record.id);
  });
  const recordIds = new Set(records.map((record) => record.id));
  for (const entry of fs.readdirSync(screenshotsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !recordIds.has(entry.name) && !protectedIds.has(entry.name)) {
      fs.rmSync(path.join(screenshotsDir, entry.name), { recursive: true, force: true });
    }
  }
}

cleanupArtifacts();

function recoverInterruptedJobs() {
  for (const name of fs.readdirSync(jobsDir).filter((value) => /^[a-f0-9-]+\.json$/i.test(value))) {
    const filePath = path.join(jobsDir, name);
    try {
      const job = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!["queued", "running", "waiting_login", "waiting_captcha"].includes(job.status)) {
        continue;
      }
      job.rows = Array.isArray(job.rows) ? job.rows : (Array.isArray(job.inputRows) ? job.inputRows : []);
      job.status = "partial";
      job.message = `Agent stopped after ${Number(job.processed || 0)}/${Number(job.total || 0)} results; saved rows are available.`;
      job.error = "";
      job.updatedAt = new Date().toISOString();
      delete job.inputRows;
      fs.writeFileSync(filePath, JSON.stringify(job, null, 2));
    } catch (error) {
      // Ignore corrupt historical job files; normal cleanup can remove them later.
    }
  }
}

recoverInterruptedJobs();

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(payload);
}

function persist(job) {
  fs.writeFileSync(path.join(jobsDir, `${job.id}.json`), JSON.stringify(job, null, 2));
}

function markJobPartial(job) {
  if (!job || ["completed", "partial", "failed"].includes(job.status)) {
    return;
  }
  job.status = "partial";
  job.message = `Agent stopped after ${Number(job.processed || 0)}/${Number(job.total || 0)} results; saved rows are available.`;
  job.error = "";
  job.updatedAt = new Date().toISOString();
  delete job.inputRows;
  persist(job);
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    processed: job.processed,
    total: job.total,
    company: job.company,
    message: job.message,
    error: job.error,
    rows: Array.isArray(job.rows) ? job.rows : undefined
  };
}

function checkExistingAgent() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/health",
      method: "GET",
      timeout: 1200
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          resolve(Boolean(body.ok));
        } catch (error) {
          resolve(false);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}

async function runQueue() {
  if (active || !queue.length) {
    return;
  }
  active = true;
  const job = queue.shift();
  currentJob = job;
  job.status = "running";
  job.updatedAt = new Date().toISOString();
  persist(job);
  const jobScreenshots = path.join(screenshotsDir, job.id);
  fs.mkdirSync(jobScreenshots, { recursive: true });
  try {
    const inputRows = job.inputRows;
    const processing = agent.processRows(inputRows, jobScreenshots, (progress) => {
      if (shutdownStarted) {
        return;
      }
      const manualKind = agent.manualIntervention?.kind;
      job.status = manualKind
        ? (manualKind === "captcha" ? "waiting_captcha" : "waiting_login")
        : (progress.status || "running");
      const nextProcessed = Number(progress.processed);
      const nextTotal = Number(progress.total);
      if (Number.isFinite(nextProcessed)) {
        job.processed = Math.max(Number(job.processed || 0), nextProcessed);
      }
      if (Number.isFinite(nextTotal) && nextTotal >= 0) {
        job.total = nextTotal;
      }
      job.company = progress.company || "";
      if (!manualKind || ["waiting_captcha", "waiting_login"].includes(progress.status)) {
        job.message = progress.message || "";
      }
      if (Array.isArray(progress.rows)) {
        job.rows = progress.rows;
      }
      job.updatedAt = new Date().toISOString();
      persist(job);
    });
    delete job.inputRows;
    const processedRows = await processing;
    if (shutdownStarted) {
      markJobPartial(job);
    } else {
      job.rows = processedRows;
      job.status = "completed";
      job.processed = job.total;
      job.message = "All Gemini results completed";
    }
  } catch (error) {
    if (shutdownStarted) {
      markJobPartial(job);
    } else {
      job.status = Number(job.processed || 0) > 0 ? "partial" : "failed";
      job.error = job.status === "failed" ? (error?.message || String(error)) : "";
      job.message = job.status === "partial"
        ? `Agent stopped after ${job.processed}/${job.total} results; saved rows are available.`
        : "Gemini Playwright job failed";
    }
  }
  job.updatedAt = new Date().toISOString();
  delete job.inputRows;
  persist(job);
  cleanupArtifacts(new Set(queue.map((queuedJob) => queuedJob.id)));
  currentJob = null;
  active = false;
  setImmediate(runQueue);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 25 * 1024 * 1024) {
      throw new Error("Request body is too large");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, {});
    return;
  }
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, { ok: true, active, queued: queue.length });
      return;
    }
    if (req.method === "POST" && url.pathname === "/auth/open") {
      await agent.openLogin({ visible: true });
      send(res, 200, { ok: true, message: "Gemini login window opened" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/jobs") {
      const body = await readJson(req);
      if (!Array.isArray(body.rows) || !body.rows.length) {
        send(res, 400, { error: "rows are required" });
        return;
      }
      const id = crypto.randomUUID();
      const job = {
        id,
        status: "queued",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        processed: 0,
        total: body.rows.length,
        company: "",
        message: "Queued",
        error: "",
        rows: body.rows.map((row) => ({ ...row })),
        inputRows: body.rows
      };
      jobs.set(id, job);
      queue.push(job);
      persist(job);
      send(res, 202, publicJob(job));
      setImmediate(runQueue);
      return;
    }
    const jobMatch = url.pathname.match(/^\/jobs\/([a-f0-9-]+)$/i);
    if (req.method === "GET" && jobMatch) {
      const id = jobMatch[1];
      let job = jobs.get(id);
      if (!job) {
        const filePath = path.join(jobsDir, `${id}.json`);
        if (fs.existsSync(filePath)) {
          job = JSON.parse(fs.readFileSync(filePath, "utf8"));
          jobs.set(id, job);
        }
      }
      if (!job) {
        send(res, 404, { error: "job not found" });
        return;
      }
      send(res, 200, publicJob(job));
      return;
    }
    send(res, 404, { error: "not found" });
  } catch (error) {
    send(res, 500, { error: error?.message || String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Gemini Playwright agent listening on http://127.0.0.1:${port}`);
  console.log("Run `npm run agent:login` once if Gemini is not already signed in.");
});

server.on("error", async (error) => {
  if (error?.code === "EADDRINUSE") {
    if (await checkExistingAgent()) {
      console.log(`Gemini Playwright agent is already running at http://127.0.0.1:${port}`);
      console.log("Use the existing agent window/process, or stop it before starting a fresh one.");
      process.exit(0);
    }
    console.error(`Port ${port} is already in use by another process. Stop it or change PLAYWRIGHT_AGENT_PORT.`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

async function shutdown() {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  markJobPartial(currentJob);
  const forceExit = setTimeout(() => process.exit(0), 5000);
  forceExit.unref();
  try {
    await agent.close();
  } catch (error) {
    // Shutdown is already in progress; persisted partial data matters more than close noise.
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown);
process.on("SIGQUIT", shutdown);
