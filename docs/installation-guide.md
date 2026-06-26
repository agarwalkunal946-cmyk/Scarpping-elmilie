# Installation Guide

## Requirements

- Google Chrome or another Chromium browser with Manifest V3 support.
- Node.js 18 or newer.
- Active EXIM Elite subscription.
- Manual access to the filtered EXIM Elite / Power BI report.
- A normal ChatGPT web account. No ChatGPT API key is required.

## Install As Unpacked Extension

1. Extract the delivered ZIP.
2. Open `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the extracted extension folder containing `manifest.json`.
6. Pin `EXIM Elite Report Exporter`.

## Install The Local Agent

Open Terminal in the extracted folder and run:

```bash
npm install
npm run agent:login
```

Sign in to ChatGPT in the Chrome window opened by Playwright. The login command detects the prompt box, saves the profile, closes Chrome, and exits automatically. Do not start `npm run agent` while `agent:login` is still running.

For normal use, start the companion agent and leave it running:

```bash
npm run agent
```

Normal agent processing runs in headless/background Chrome. The agent tries to select ChatGPT `High` mode before each batch. A visible Chrome window opens only when ChatGPT login requires manual action, then background processing resumes automatically.

Stopping the agent preserves its latest row snapshot. The extension ends the loader, shows badge `OK`, and keeps those partial rows available for export. Restarting the agent does not silently leave an old job in a running state.

The agent sends up to 25 unique companies per ChatGPT JSON-array batch. For each captured Power BI hover query, local Playwright sends the query directly to ChatGPT and asks it to find the first organic website URL, then return website/contact JSON. Up to 4 ChatGPT batch pages can run in parallel, so 100 unique rows can run as four 25-query batches at once. When free system memory drops below the safety reserve, new pages wait while running pages finish and release memory; all queued rows then continue automatically. Heavy images/media/fonts are skipped, disposable profile caches are cleared at launch without removing login cookies, Chrome's disk cache is capped, compact row snapshots avoid Chrome storage overload, and old job artifacts are pruned. The same safeguards apply on macOS and Windows.

Optional `.env` controls are `CHATGPT_HEADLESS=true|false` (default `true`), `CHATGPT_BATCH_SIZE=1..50` (default `25`), `CHATGPT_BATCH_PARALLELISM=1..4` (default `4`), `CHATGPT_BATCH_TIMEOUT_MS` (default `600000`), `CHATGPT_PROMPT_REVIEW_MS` (default `0`), `CHATGPT_MIN_FREE_MEMORY_MB` (default `2048`), `CHATGPT_DISK_CACHE_MB=32..1024`, `CHATGPT_BLOCK_HEAVY_RESOURCES=true|false`, `AGENT_ARTIFACT_RETENTION_DAYS`, and `AGENT_ARTIFACT_MAX_JOBS`.

The extension Settings page can open the ChatGPT login window only while the local agent is running.

## Manual Login

1. Open `https://eximelite.com/member-login/`.
2. Log in manually with the authorized account.
3. Complete captcha manually.
4. Open the EXIM Data Analytics Tool.
5. Select the required HSN, year, month, and country filters.

## Updating

After replacing the extension files:

1. Open `chrome://extensions`.
2. Click reload on `EXIM Elite Report Exporter`.
3. Refresh the EXIM Elite report tab.
4. Wait for Power BI to finish loading.
5. Restart `npm run agent` if agent files or dependencies changed.
