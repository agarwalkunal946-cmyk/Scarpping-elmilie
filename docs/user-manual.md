# User Manual

## Popup Controls

- `Backup`: maximum fallback scroll attempts when direct Power BI capture is unavailable.
- `Dedupe`: keeps one contact record per HSN, Consignee, and country.
- `Top first`: starts fallback table capture from the top.
- `Check`: reads currently visible report rows.
- `Capture All`: captures all available filtered Power BI rows, then starts the persistent Playwright contact job.
- `Find Contacts`: starts a fresh Playwright contact job for already captured rows.
- `CSV` / `Excel`: exports the final five columns.

## Recommended Workflow

1. Log in and solve captcha manually.
2. Open the EXIM analytics report and apply filters.
3. Refresh once after installing or reloading the extension.
4. Start `npm run agent`.
5. Click `Capture All`. The popup may be closed while the background job continues.
6. Review Website, Email, and Phone counters.
7. Use `Find Contacts` only if you want to rerun ChatGPT lookup.
8. Export CSV or Excel.

Normal processing follows `.env`. With `CHATGPT_HEADLESS=false` and `GOOGLE_HEADLESS=false`, ChatGPT and Google query windows stay visible/foreground. If `npm run agent` is stopped, the extension shows `OK` and keeps the latest saved partial rows exportable.

## AI Contact Rules

- Website Name is the Consignee name from Power BI.
- The agent searches captured hover queries on Google in up to 6 visible tabs and stores up to 3 organic website candidates.
- As soon as 25 Google result sets are ready, they are sent to ChatGPT for first-valid URL selection and phone/email extraction while later Google searches continue.
- Up to 4 ChatGPT batch pages can run in parallel.
- ChatGPT selects the first valid non-social/non-sponsored website candidate, then checks that selected website/domain for email and phone; if missing, it may deep-search clearly connected public sources while keeping the Website URL unchanged.
- Missing or uncertain values remain blank.

## ChatGPT Website

The automation tries to select ChatGPT `High` mode before every batch. With foreground mode enabled, ChatGPT and Google query windows stay visible. Model availability, limits, and results depend on that ChatGPT account.

## Final Columns

`HSN Code | Website Name | Website URL | Email | Phone`
