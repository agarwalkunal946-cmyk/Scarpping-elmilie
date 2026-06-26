const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exim-agent-recovery-"));
const jobsDir = path.join(fixtureRoot, "agent-data", "jobs");
const jobId = "22222222-2222-4222-8222-222222222222";
const port = 46000 + (process.pid % 1000);

fs.mkdirSync(jobsDir, { recursive: true });
fs.writeFileSync(path.join(jobsDir, `${jobId}.json`), JSON.stringify({
  id: jobId,
  status: "running",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  processed: 4,
  total: 10,
  company: "Saved Company",
  message: "Working",
  error: "",
  rows: [{ websiteName: "Saved Company", websiteUrl: "https://saved.example/" }],
  inputRows: [{ websiteName: "Original Company" }]
}, null, 2));

const child = spawn(process.execPath, [path.join(root, "agent", "server.js")], {
  cwd: fixtureRoot,
  env: { ...process.env, PLAYWRIGHT_AGENT_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (output.includes("ChatGPT Playwright agent listening")) {
      return;
    }
    if (child.exitCode !== null) {
      throw new Error(`Recovery test server exited early:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Recovery test server did not start:\n${output}`);
}

(async () => {
  try {
    await waitForServer();
    const response = await fetch(`http://127.0.0.1:${port}/jobs/${jobId}`);
    assert.equal(response.status, 200);
    const job = await response.json();
    assert.equal(job.status, "partial");
    assert.equal(job.processed, 4);
    assert.equal(job.total, 10);
    assert.equal(job.rows[0].websiteName, "Saved Company");
    assert.match(job.message, /saved rows are available/i);

    const persisted = JSON.parse(fs.readFileSync(path.join(jobsDir, `${jobId}.json`), "utf8"));
    assert.equal(persisted.status, "partial");
    assert.equal("inputRows" in persisted, false);
    console.log("Server interrupted-job recovery tests passed");
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGINT");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
