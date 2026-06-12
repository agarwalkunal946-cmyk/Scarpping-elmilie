# Installation Guide

## Requirements

- Google Chrome or another Chromium browser with Manifest V3 support.
- Node.js 18 or newer.
- Active EXIM Elite subscription.
- Manual access to the filtered EXIM Elite / Power BI report.
- A normal Gemini web account. No Gemini API key is required.

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

Sign in to Gemini in the Chrome window opened by Playwright. The login command detects the prompt box, saves the profile, closes Chrome, and exits automatically. Do not start `npm run agent` while `agent:login` is still running.

For normal use, start the companion agent and leave it running:

```bash
npm run agent
```

The extension Settings page can open the Gemini login window only while the local agent is running.

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
