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

Normal processing runs in headless/background Chrome. A visible Chrome window opens only for ChatGPT login, and processing resumes in the background after it is solved. If `npm run agent` is stopped, the extension shows `OK` and keeps the latest saved partial rows exportable.

## AI Contact Rules

- Website Name is the Consignee name from Power BI.
- Unique companies are grouped into up to 25-row ChatGPT batches with only `batch_id` and the captured hover query.
- The agent sends each captured hover query directly to ChatGPT in one JSON-array prompt per batch.
- Up to 4 ChatGPT batch pages can run in parallel, so 100 unique rows can run as four 25-query batches at once.
- ChatGPT finds the first normal organic website URL for each query.
- ChatGPT first checks that selected website/domain for email and phone; if missing, it may deep-search clearly connected public sources while keeping the Website URL unchanged.
- Missing or uncertain values remain blank.

## ChatGPT Website

The automation tries to select ChatGPT `High` mode before every batch. Normal processing is headless/background; a browser is shown only for ChatGPT login or manual challenge. Model availability, limits, and results depend on that ChatGPT account.

## Final Columns

`HSN Code | Website Name | Website URL | Email | Phone`
