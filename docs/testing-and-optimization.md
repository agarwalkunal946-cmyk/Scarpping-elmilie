# Testing And Optimization

## Automated Checks

Run:

```bash
npm test
```

Tests verify:

- shifted/invalid Power BI rows are rejected;
- Playwright Gemini JSON contact output is parsed;
- the Playwright first-result contact flow preserves portal/directory URLs when they are the first non-sponsored result;
- CSV and Excel contain exactly five columns;
- Excel Website URL hyperlinks target the selected website, not Google search.

## Manual Test

1. Install/reload the extension and refresh the EXIM report.
2. Apply a narrow HSN/country filter for initial testing.
3. Run `npm run agent` and confirm `http://127.0.0.1:4318/health` responds.
4. Click `Capture All`; switching tabs should not stop the job.
5. Verify HSN/Website Name rows and Website/Email/Phone counters.
6. Compare several selected Website URLs with Gemini/Google's grounded answer.
7. Export and verify the five columns.

## Constraints

Gemini may return blank values when the first non-sponsored result does not expose contact details or the web account reaches a usage limit. Login and captcha remain manual. Google/Gemini UI changes can require selector maintenance.

## Automated Pipeline

The automated test suite validates strict JSON parsing, first-result portal preservation for Playwright, Google query preservation, and final five-column CSV/XLSX output. Live Gemini UI testing requires a signed-in browser profile.
