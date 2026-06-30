# EXIM Elite Contact Exporter

Chrome extension plus a local Playwright agent for extracting filtered EXIM Elite / Power BI rows and finding company contacts through the signed-in Gemini website.

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

No Gemini API key is used. The agent automates the normal Gemini website in a persistent local Chrome profile.
After the one-time `npm run agent:login`, normal `npm run agent` processing follows `.env`: `GEMINI_HEADLESS=false` and `GOOGLE_HEADLESS=false` keep Gemini and Google query Chrome windows visible/foreground.
If the agent is stopped, every row snapshot received so far remains available for CSV/Excel export; the loader stops and the badge shows `OK` for the saved partial result.
The agent searches captured hover queries on Google in up to `GOOGLE_SEARCH_PARALLELISM=6` visible tabs using a separate Google profile, waits for Google results, stores up to 3 organic website candidates, then sends ready candidates to Gemini in up to `GEMINI_BATCH_SIZE=15` batches for URL selection and phone/email extraction. As soon as 15 Google result sets are ready, that Gemini batch can start while later Google searches continue. It does not resend failed Gemini JSON requests; when a batch response is unavailable, missing contact fields stay blank.
Up to `GEMINI_BATCH_PARALLELISM=4` Gemini batch pages can run in parallel. The exact prompt is saved beside each job artifact as `*-gemini-prompt.txt`. Use one persistent Chrome profile instead of many Chrome processes; workers keep only the needed Google/Gemini pages open, wait when free system memory is low, block images/media/fonts/styles in headless mode, cap Chrome disk cache, store compact row snapshots, and prune old job artifacts automatically.

## Accuracy Rules

- Power BI remains the source for HSN and Website Name (Consignee).
- One click starts the whole job. Duplicate companies reuse the same result.
- The agent searches each captured hover query on Google and sends up to 3 organic website candidates to Gemini.
- Gemini selects the first valid non-social/non-sponsored website candidate, then uses deepsearch websearch scraping on that selected website/domain for email and phone while keeping the Website URL unchanged.
- Unverified or unavailable data stays blank rather than being guessed.
- Login, captcha, subscription, and website security are never bypassed.
- Browser UI automation can break if Google or Gemini changes its page layout, and no AI workflow can guarantee 100% contact accuracy.

See [Installation Guide](docs/installation-guide.md), [User Manual](docs/user-manual.md), and [Export Instructions](docs/export-instructions.md).
