# Testing And Optimization

## Automated Checks

Run:

```bash
npm test
```

Tests verify:

- shifted/invalid Power BI rows are rejected;
- Playwright ChatGPT JSON contact output is parsed;
- the Playwright ChatGPT flow preserves first-organic portal/directory URLs returned by ChatGPT;
- CSV and Excel contain exactly five columns;
- Excel Website URL hyperlinks target the selected website, not Google search.

## Manual Test

1. Install/reload the extension and refresh the EXIM report.
2. Apply a narrow HSN/country filter for initial testing.
3. Run `npm run agent` and confirm `http://127.0.0.1:4318/health` responds.
4. Click `Capture All`; switching tabs should not stop the job.
5. Verify HSN/Website Name rows and Website/Email/Phone counters.
6. Compare several selected Website URLs with ChatGPT's grounded answer.
7. Export and verify the five columns.

## Constraints

ChatGPT may return blank values when neither the first organic website nor clearly connected public sources expose contact details, or when the web account reaches a usage limit. Login and captcha remain manual. ChatGPT UI changes can require selector maintenance.

## Automated Pipeline

The automated test suite validates strict JSON parsing, first-organic URL preservation for Playwright, query preservation, and final five-column CSV/XLSX output. Live ChatGPT UI testing requires a signed-in browser profile.
