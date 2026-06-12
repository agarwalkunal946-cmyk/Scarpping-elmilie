# Export Instructions

## Required Steps

1. Click `Capture All` on the filtered EXIM report.
2. The popup loader starts immediately. You may switch tabs or close the popup; the local agent continues.
3. The extension badge shows `AI` while running, `IN` when Gemini login is needed, `OK` when complete, and `!` on failure.
4. Reopen the popup to see live progress and the completed Website, Email, and Phone counters.
5. Optional: click `Find Contacts` to start a fresh lookup for already captured rows.
6. Click `CSV` or `Excel`.

## Exported Columns

- HSN Code
- Website Name
- Website URL
- Email
- Phone

`Website Name` is the Consignee name shown by Power BI. Each unique company is processed with its extracted Google organic result links and a strict Gemini JSON prompt. Missing or unverified contacts remain blank.

Excel Website URL cells are clickable. CSV contains plain URLs. Missing or unverified contacts remain blank.
