# Editorial Calendar Generator — Bug Fixes (Internal)

Source: `MEGWebTeam/Editorial-Calendar-Automation` (index.html + MEG_Calendar_Backend_AppsScript.js)

Two files are attached, ready to drop back into the repo:
- `index.html` — replaces the file of the same name
- `MEG_Calendar_Backend_AppsScript.js` — replaces the Apps Script backend

## What was actually broken, and why

**1. August only produced ~1 week of content, then jumped to September.**
Root cause: the quarter-month math. The old code built month 2 and month 3's "start" by shifting the *same day-of-month* as the quarter start date forward — quarter start July 20 became "August 20," "September 20." The prompt then told Claude the month was "starting around Aug 20," so the model correctly generated content from roughly Aug 20 onward and skipped the first three weeks entirely. This wasn't the model improvising; it was doing exactly what the date math told it to do.
Fix: `buildMonthRanges()` in `index.html` now computes the true calendar boundaries for months 2 and 3 (the 1st through the last real day of that month), and only month 1 stays partial at the exact date you picked.

**2. Content types that weren't part of the package (Story, Carousel) showed up starting in September.**
Root cause: the system prompt's type whitelist was hard-coded to `Video Graphic Reel Carousel Story Email` regardless of what was actually configured in the form. There's no "Reels/week" or "Stories/week" input anywhere in the tool, so the model had a green light to invent them.
Fix: the whitelist is now built dynamically from the deliverables you actually set above zero (Videos, Graphics, Emails, and the new Blogs field). If a type isn't contracted, it isn't in the list Claude is allowed to use.

**3. Dates out of order within a month (9/11, 9/03, 9/21).**
Root cause: two compounding issues. The date field had no required format, so Claude could return inconsistent, non-sortable strings, and the app never sorted the combined results before rendering or export — it just displayed items in whatever order each of the three API calls returned them.
Fix: the prompt now requires strict ISO 8601 (`YYYY-MM-DD`) dates, and after all three months come back, `allPosts.sort()` orders everything chronologically before it's rendered or exported.

**4. Campaign naming changed mid-document (named campaigns, then "Core Offer" / "Entry Offer" / "Expansion Offers").**
Root cause: two things. Each month is generated in a separate, independent API call with no memory of the prior calls, so naming could drift on its own. On top of that, the strategy document was truncated to the first 4,000 characters per call — if the campaign names appeared later in the doc, a later month's call would lose that anchor and could fall back to the offer-stage language used elsewhere in the strategy doc.
Fix: the strategy excerpt sent per call is now up to 12,000 characters, the system prompt has an explicit hard rule against substituting stage labels for real campaign names, and each month's call is now told the exact campaign name strings used in prior months of the same quarter so it reuses them verbatim.

**5. It silently returned incomplete data with no warning.**
Root cause: when a Claude response got cut off (hit the `max_tokens` limit mid-item), the JSON-repair logic in the frontend would quietly truncate to the last complete item and carry on as if nothing had happened. Compounding that, `max_tokens` was set to 8000 in the backend — tight for a full month of items with descriptions, hooks, and CTAs.
Fix: `max_tokens` raised to 16000 in the backend, the model bumped from the deprecated `claude-sonnet-4-20250514` to `claude-sonnet-5` (128k token output ceiling on the standard API, no beta header needed), and the backend now explicitly checks `stop_reason` and throws a clear error if a response was cut off, instead of returning it as if it were complete. The frontend also now flags (in a visible warning banner) any month where repair-truncation happened, any items whose dates fell outside the requested range, and any exact duplicate rows — instead of staying silent.

**6. It generates all 3 months in one run.**
This is by design, not a bug — the tool is built to fill a full quarter from one "Quarter Start Date." Given how much more can go wrong across three independent generations, you may want to generate and review one month at a time for now, especially while validating the fixes above. That's a product decision, not a code fix, so it wasn't changed, but flagging it since it compounds every other issue above.

## New: SEO / Blog line item

Added a "Blogs / month" field next to Emails. Set it above zero and the tool adds `Blog` as its own contracted content type, generated as standalone SEO items (no production day, no hook) with its own count target per month, same as Emails.

## New: Word (.docx) and Excel (.xlsx) strategy docs now work

**Symptom:** pasting a Google Doc URL for a strategy document failed with "Could not open file... document is inaccessible," even though sharing was correctly set to "Anyone with the link can view."
**Root cause:** the file was a real Word document sitting in Google Drive (viewable/editable through the Google Docs interface, but not actually converted to native Google Docs format). `DocumentApp.openById()` can only open native Google Workspace files — it fails on Office files regardless of sharing settings, and the resulting error looked identical to a permissions problem.
**Fix:** `fetchDoc` now tries the native open first, and if that fails, makes one converted copy of the file in native Google Docs/Sheets format via the Drive API (v2 advanced service), reads the converted copy, then deletes it. This happens automatically — no manual "Save as Google Docs" step needed going forward, for either Word or Excel files.
**Setup required:** this needs the Drive API advanced service enabled once, per Apps Script project — see Step 1.5 in the file header. Without it enabled, the tool now fails with an explicit "enable the Drive API" message instead of a confusing "inaccessible" one, so it's obvious what to do.
**To verify it's working:** in the Apps Script editor, run `testDriveConversionSetup()` from the function dropdown and check the log.

## To redeploy

1. Apps Script: open the project behind `MEG_Calendar_Backend_AppsScript.js`, replace its contents with the attached version. Enable the Drive API advanced service (Services → + → Drive API → version v2 → Add) if you want `.docx`/`.xlsx` strategy docs to work. Redeploy (Deploy → Manage deployments → Edit → New version).
2. GitHub: replace `index.html` in the repo with the attached version and push to `main` — Vercel will auto-deploy.
3. Test with a single month first (set a start date and mentally check the output against a client you already know well) before running a full quarter for a real client.

## What this does not fix

This patch fixes the generation mechanics — date math, type whitelist, campaign-name consistency, truncation handling, sorting. It does not and cannot fix bad or thin strategy documents: if a client's strategy doc doesn't clearly state campaign names, ICPs, or content themes, the model will still have to guess at some of that, since the prompt explicitly forbids inventing generic industry themes not in the doc. Garbage in, garbage out still applies.
