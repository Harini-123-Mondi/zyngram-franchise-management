# Zyngram Franchise Registration — Day 7

A Google Apps Script web app backed by Google Sheets. This Day 7 project covers customer registration, physical franchise mapping, duplicate prevention, a live dashboard, and input/error handling. Later-day features are intentionally not mixed into this deliverable.

## Project files

- `Code.gs` — Apps Script web entry point, database setup, validation, franchise matching, locking, safe writes, and dashboard data.
- `Index.html` — Responsive registration form and dashboard using `google.script.run`.
- `Styles.html` — Styles included by the HTML template.
- `appsscript.json` — Apps Script V8 runtime and spreadsheet scope.

## Create and deploy the Apps Script web app

1. In [script.google.com](https://script.google.com), create a standalone Apps Script project.
2. Add `Code.gs`, `Index.html`, and `Styles.html` with the matching contents from this folder. In **Project Settings**, show the `appsscript.json` manifest file if it is hidden, then copy the manifest contents.
3. Select `setupDatabase` in the editor and click **Run**. Review and grant the requested Sheets permission. This creates **Zyngram Franchise Database** with `Users` and `Franchise` sheets, headers, and three sample Points across two Centers, two Hubs, and one Command. The spreadsheet URL is written to the Apps Script execution log.
4. Choose **Deploy → New deployment → Web app**. Set **Execute as** to the trusted deploying account so the app can write to its spreadsheet. Restrict access to intended signed-in users or the organization where available; do not enable anonymous public access for customer data.
5. Open the deployment URL, then test the sample mapping with State `Telangana`, District `Hyderabad`, City `Hyderabad`, PIN `500001`, and service `Delivery`.

The account that owns the Apps Script and spreadsheet should be a trusted administrator. Share the spreadsheet only with trusted database administrators; web-app users should use the Web App and should not receive direct Sheet access. Do not put the private spreadsheet ID or customer rows in client-side code.

## Day 7 acceptance checks

- Required fields, mobile, email, PIN, supported service, duplicate mobile and duplicate email are validated. Errors are shown to the user.
- `getFranchiseMapping` compares normalized State, District, City, and PIN with active Franchise entries. Missing or ambiguous matches do not invent a franchise assignment.
- `registerUser` repeats validation and duplicate checks on the server under a script lock, writes a unique User ID, mapped hierarchy/status, and registration date, then returns the result for the success dialog.
- `getDashboardData` returns total, mapped, unmapped and active-Point counts, users grouped by Center and Hub, and the ten latest registrations. The recent-registration summary omits names, mobile numbers and emails.
- The `Users` and `Franchise` tabs are initialized automatically if missing. A trusted administrator can update sample or live franchise records in the `Franchise` sheet.

This folder contains the source project only. Creating the actual Google Sheet, authorizing it, and publishing a live URL require access to the user's Google account; those actions cannot be performed from this local workspace.