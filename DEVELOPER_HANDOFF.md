# Editorial Calendar Generator — Developer Handoff

Repo: `https://github.com/MEGWebTeam/Editorial-Calendar-Automation`
Live tool: `https://editorial-calendar-automation.vercel.app/`
Stack: static HTML/JS frontend on Vercel, Google Apps Script Web App backend, Claude API for generation.

## What this tool does

Internal MEG tool. User fills in a client's deliverables (videos/graphics per week, emails and blogs per month, posting days, platforms) and pastes or fetches a strategy document, and the tool calls Claude three times (once per month of a quarter) to generate a full editorial calendar as a table and downloadable CSV.

## What was reported broken

Original report, verbatim from the requesting stakeholder:
- August only generated about one week of content before the output jumped to September.
- Content types outside the contracted package (Story, Carousel) started appearing on their own.
- Dates within a month were out of order (e.g. 9/11, 9/03, 9/21).
- The "Campaign" column inconsistently switched between real campaign names and generic offer-stage labels ("Core Offer," "Entry Offer").
- The tool generates all 3 months of a quarter in one run (by design, flagged as something to reconsider given how much else was going wrong per-run).
- Requested addition: an optional SEO/blog line item, configurable as a count per month.

A second, separate round of bugs surfaced after the first patch was deployed:
- The whole UI went dead (day-selector buttons did nothing, Fetch button did nothing) — root cause was literal control-byte and invisible-Unicode characters embedded in `index.html`'s source instead of safe `\u`-escape text, most likely introduced by a copy/paste operation. This corrupts the entire `<script>` block silently.
- After that was fixed, fetching a strategy doc by URL failed with "document is inaccessible" even with correct Drive sharing — root cause was the file being a real `.docx` sitting in Drive, not a native Google Doc; `DocumentApp.openById()` can't open Office-format files regardless of sharing settings.

## Root causes and fixes (detailed)

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | August cut off after ~1 week | Month 2/3 "start" was computed by shifting the same day-of-month forward (Jul 20 → "Aug 20"), so the prompt told Claude to start each month partway through it | `buildMonthRanges()` now uses the true calendar boundaries (1st–last day) for months 2 and 3; only month 1 stays partial at the chosen start date |
| 2 | Unrequested Story/Carousel posts | System prompt's type whitelist was hardcoded to `Video Graphic Reel Carousel Story Email` regardless of configured deliverables | Whitelist is now built dynamically from whatever deliverables are set above zero (Video/Graphic/Email/Blog) |
| 3 | Dates out of order | No required date format + results never sorted before render/export | Prompt requires strict ISO 8601 dates; `allPosts.sort()` runs after all three months are collected |
| 4 | Campaign naming drift | Each month is an independent API call with no shared memory, and the strategy doc was truncated to 4,000 chars/call | Excerpt raised to 12,000 chars; explicit hard rule against generic offer-stage labels; each call is told the exact campaign names used in prior months to reuse verbatim |
| 5 | Silent incomplete output | `max_tokens: 8000` in the backend, and truncated JSON was silently repaired/truncated further on the frontend with no warning | `max_tokens` raised to 16000, model bumped to `claude-sonnet-5`, backend throws on `stop_reason === 'max_tokens'`, frontend surfaces a visible warning banner for any truncation, out-of-range dates, or duplicate rows |
| 6 | Dead UI (day buttons, fetch button did nothing) | Literal control-byte / invisible-Unicode characters embedded in `index.html` instead of `\u`-escape text — breaks the entire script silently | Rebuilt the two affected regex literals using code-point construction; verified byte-for-byte no stray control/invisible characters remain anywhere in the file |
| 7 | "Document is inaccessible" on a correctly-shared Google Doc URL | File was a `.docx` in Drive, not a native Google Doc — `DocumentApp.openById()` can't open Office files regardless of sharing | `fetchDoc` now tries native open first, falls back to making a converted copy via Drive API v2 (`Files.insert(..., {convert:true})`), reads the copy, deletes it. Same pattern added for `.xlsx` via `SpreadsheetApp` |

New feature: "Blogs / month" field, adds `Blog` as its own contracted type/line item alongside Video/Graphic/Email.

## Files in this handoff

- `index.html` — full replacement for the repo's `index.html`.
- `MEG_Calendar_Backend_AppsScript.js` — full replacement for the Apps Script backend project's code.
- This file.

## Deployment steps

1. **Frontend:** In the GitHub repo, replace `index.html` with the attached version. Use "Upload files" / a real commit (drag-and-drop or `git add` + `git push`) rather than pasting into GitHub's web text editor — pasting into a browser textarea is exactly what caused bug #6 above (it can silently strip/reorder invisible characters). Push to `main`; Vercel auto-deploys on push, no manual trigger needed.
2. **Backend:** Open the Apps Script project tied to this tool (Extensions → Apps Script from the script's bound doc, or via script.google.com if it's standalone). Replace all code with the attached `MEG_Calendar_Backend_AppsScript.js`.
3. **Enable Drive API advanced service** (required for fix #7 — `.docx`/`.xlsx` auto-conversion): left sidebar → Services (+) → "Drive API" → set version dropdown to **v2** → Add. Confirm the code's `Drive.Files.insert(...)` calls match v2 syntax (they do, as written) if this ever gets migrated to v3 later.
4. **Redeploy:** Deploy → Manage deployments → edit (pencil icon) the existing deployment → Version: "New version" → Deploy. This keeps the same Web App URL, so `BACKEND_URL` in `index.html` does not need to change.
5. **Verify CLAUDE_API_KEY** is still present in Script Properties (Project Settings gear icon) — unaffected by this patch, but worth a glance since the model string changed.

## Verification steps

Run these from the Apps Script editor's function dropdown before considering this done:
- `testClaudeConnection` — confirms the API key and model string work.
- `testDriveConversionSetup` — confirms the Drive API advanced service is enabled.

Then, in the live tool: run one small real generation (one client, one month, ideally a `.docx` strategy file) and check that:
- Every date in the output falls within the selected month.
- No Story/Carousel/Reel items appear unless those deliverables were actually configured.
- Campaign names are consistent and match the strategy doc's actual campaign names, not generic offer-stage labels.
- The results are sorted chronologically with no duplicate date+type+name rows.

## What has NOT been live-verified (be aware)

I do not have access to this team's live Apps Script deployment, Claude API key, or a real client strategy doc, so the following were verified by static analysis and isolated logic testing in a browser console, not a full end-to-end run:
- The actual Claude-generated output quality against a real strategy doc.
- The Drive API v2 conversion call (`Drive.Files.insert` with `convert: true`) against a real `.docx` file — the code follows the standard, well-documented pattern for this, but has not been executed in this specific Apps Script project.
- The full page load of `index.html` as actually hosted (I verified the extracted script's logic and DOM interactions in an isolated browser context, and confirmed zero corrupted bytes in the file, but could not load the file directly from a live URL during this session).

Recommend the developer run the verification steps above before telling the wider team it's fixed.
