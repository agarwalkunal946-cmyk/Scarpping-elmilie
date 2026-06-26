# EXIM Elite Contact Exporter

Chrome extension plus a local Playwright agent for extracting filtered EXIM Elite / Power BI rows and finding company contacts through the signed-in ChatGPT website.

## Output

The CSV and Excel files contain exactly:

- HSN Code
- Website Name
- Website URL
- Email
- Phone

## Workflow

1. Log in to EXIM Elite manually and solve captcha.
2. Open the Power BI report and apply HSN/year/month/country filters.
3. Run `npm install`.
4. Run `npm run agent:login` and sign in. Wait for login confirmation; the Playwright Chrome window closes automatically.
5. Run `npm run agent` and leave that terminal running.
6. Click `Capture All`. You may switch tabs or close the popup; the extension badge shows `AI` while work continues.
7. Reopen the popup after the badge changes to `OK`, then export CSV or Excel.

No ChatGPT API key is used. The agent automates the normal ChatGPT website in a persistent local Chrome profile.
After the one-time `npm run agent:login`, normal `npm run agent` processing runs in headless/background Chrome. A visible Chrome window opens only when ChatGPT login needs manual action, then processing resumes in the background after it is solved.
If the agent is stopped, every row snapshot received so far remains available for CSV/Excel export; the loader stops and the badge shows `OK` for the saved partial result.
The agent batches up to `CHATGPT_BATCH_SIZE=25` unique companies into one ChatGPT request and waits for a full JSON array back. It does not resend failed ChatGPT JSON requests; when a batch response is unavailable, missing website/contact fields stay blank.
The local agent sends captured hover queries directly to ChatGPT. Each 25-row prompt asks ChatGPT to find the first organic website URL for each query, then return website/contact JSON. Up to `CHATGPT_BATCH_PARALLELISM=4` ChatGPT batch pages can run in parallel, so 100 unique rows can run as four 25-query batches at once. The exact prompt is also saved beside each job artifact as `*-chatgpt-prompt.txt`. Use one persistent Chrome profile instead of many Chrome processes; workers keep only the needed ChatGPT pages open, wait when free system memory is low, block images/media/fonts/styles in headless mode, cap Chrome disk cache, store compact row snapshots, and prune old job artifacts automatically.
Before sending each batch, the agent tries to select ChatGPT `High` mode from the composer. If the selector is unavailable, it continues with the currently selected ChatGPT mode.

## Accuracy Rules

- Power BI remains the source for HSN and Website Name (Consignee).
- One click starts the whole job. For speed and reliability, unique companies are grouped into 25-row ChatGPT batches; duplicate rows reuse the same result.
- The agent gives each captured hover Google query directly to ChatGPT in one JSON-array prompt per batch.
- ChatGPT is instructed to find the first normal organic website URL for each query.
- ChatGPT first checks that selected website/domain for email and phone; if missing, it may deep-search clearly connected public sources while keeping the Website URL unchanged.
- Unverified or unavailable data stays blank rather than being guessed.
- Login, captcha, subscription, and website security are never bypassed.
- Browser UI automation can break if Google or ChatGPT changes its page layout, and no AI workflow can guarantee 100% contact accuracy.

See [Installation Guide](docs/installation-guide.md), [User Manual](docs/user-manual.md), and [Export Instructions](docs/export-instructions.md).
