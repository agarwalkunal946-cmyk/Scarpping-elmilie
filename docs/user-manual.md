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
7. Use `Find Contacts` only if you want to rerun Gemini lookup.
8. Export CSV or Excel.

## AI Contact Rules

- Website Name is the Consignee name from Power BI.
- Each unique company gets the top 10-15 Google organic result links plus company name, country, HSN, the report's captured hover Google query URL, and first non-sponsored candidate.
- The extracted Google result list is sent to Gemini as text, so the normal flow no longer waits for screenshot capture or image upload.
- Ads, sponsored results, social networks, map listings, unrelated companies, and Google redirect/cache URLs are rejected in the prompt.
- The Playwright Gemini flow uses Rank 1 from the non-sponsored organic result list, including trade-data portals/directories when they are the first result.
- Email and phone are accepted from Gemini's JSON answer only when visible for the same company/listing on that first result page or its direct detail/contact page.
- Missing or uncertain values remain blank.

## Gemini Website

The automation uses the model currently selected by the signed-in Gemini website. Model availability, limits, and results depend on that Gemini account.

## Final Columns

`HSN Code | Website Name | Website URL | Email | Phone`
