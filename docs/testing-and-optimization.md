# Testing And Optimization

## Automated Checks

Run:

```bash
npm test
```

Tests verify:

- shifted/invalid Power BI rows are rejected;
- Playwright Gemini JSON contact output is parsed;
- the Playwright flow waits for Google candidates before sending them to Gemini for first-valid URL selection;
- CSV and Excel contain exactly five columns;
- Excel Website URL hyperlinks target the selected website, not Google search.

## Manual Test

1. Install/reload the extension and refresh the EXIM report.
2. Apply a narrow HSN/country filter for initial testing.
3. Run `npm run agent` and confirm `http://127.0.0.1:4318/health` responds.
4. Click `Capture All`; switching tabs should not stop the job.
5. Verify HSN/Website Name rows and Website/Email/Phone counters.
6. Compare several selected Website URLs with Gemini's grounded answer.
7. Export and verify the five columns.

## Constraints

Google search may require manual CAPTCHA solving. Gemini may return blank values when neither the locked website nor clearly connected public sources expose contact details, or when the web account reaches a usage limit. Login and captcha remain manual. Google/Gemini UI changes can require selector maintenance.

## Automated Pipeline

The automated test suite validates strict JSON parsing, first-organic URL preservation for Playwright, query preservation, and final five-column CSV/XLSX output. Live Gemini UI testing requires a signed-in browser profile.
