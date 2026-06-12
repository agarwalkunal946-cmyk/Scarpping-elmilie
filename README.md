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

## Accuracy Rules

- Power BI remains the source for HSN and Website Name (Consignee).
- One click starts the whole job. For speed, each unique company gets its top Google organic result links extracted as text and sent in one Gemini JSON request; duplicate rows reuse the same result.
- The agent uses the captured hover Google query URL from the report first, then extracts the top 10-15 non-sponsored Google organic links from the loaded page. It no longer needs to upload a Google screenshot to Gemini for the normal flow.
- Google sponsored results, social sites, maps, redirects, and unrelated similarly named companies are rejected.
- Gemini is instructed to use Rank 1 from the extracted non-sponsored organic result list, even when that result is a trade-data portal, directory, or profile page.
- Email and phone are accepted only when visible for the same company/listing on that first result page or its direct detail/contact page.
- Unverified or unavailable data stays blank rather than being guessed.
- Login, captcha, subscription, and website security are never bypassed.
- Browser UI automation can break if Google or Gemini changes its page layout, and no AI workflow can guarantee 100% contact accuracy.

See [Installation Guide](docs/installation-guide.md), [User Manual](docs/user-manual.md), and [Export Instructions](docs/export-instructions.md).
