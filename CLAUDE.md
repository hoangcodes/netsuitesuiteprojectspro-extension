# OpenAir Timesheet Importer — Chrome Extension Build Spec

## Goal
Build a Manifest V3 Chrome extension (unlisted on Chrome Web Store) that lets a
non-technical user drag their weekly Excel timesheet onto the OpenAir
timesheet page and have it fill in hours + notes automatically, with a
confirmation step before anything is written to the page.

User's required workflow (do not add steps beyond this):
1. Open the OpenAir weekly timesheet page (already logged in).
2. Drag their `.xlsx` file onto a panel injected into the page (or click the
   panel to open a file picker — support both).
3. Review a preview table showing what will be entered.
4. Click "Confirm" → data is written into the OpenAir form. Click "Cancel" →
   nothing happens, user fixes their Excel file and retries.

No console, no bookmarklet, no copy-pasting scripts. This replaces an existing
manual workflow where the user runs a hand-built JS snippet in DevTools.

## Already scaffolded (in this folder, use as-is)
- `manifest.json` — MV3 manifest, content script injected on
  `https://*.openair.com/*`. **The host_permissions match pattern is a
  placeholder — confirm the company's actual OpenAir URL (e.g.
  `https://na1.openair.com/*` or a custom subdomain) and update it.**
- `lib/xlsx.full.min.js` — SheetJS bundle, already vendored locally (required
  since MV3 disallows remotely-hosted/CDN-loaded code execution). Load this
  before `content.js` in the manifest (already wired).
- `icons/icon16.png`, `icon48.png`, `icon128.png` — placeholder icons, replace
  with real branding if desired before publishing.

## Still to build
- `content.js` — all logic described below.
- `content.css` — styling for the injected drop-zone panel and confirmation
  modal.

## Input: Excel file format
Columns are day-pairs: `Sunday time`, `Sunday notes`, `Monday time`,
`Monday notes`, ... through Saturday (header text may vary slightly in
casing/spacing — match flexibly, e.g. `/sun(day)?\s*time/i`). The first two
columns are `Client` and `Task`, entered as free text by the user (not
dropdowns — that's only true in the Excel sheet). Each row in Excel = one
client/task combination for that person's week.

Parse with SheetJS (`XLSX.read` on FileReader result, `XLSX.utils.sheet_to_json`
with `header: 1` to get raw rows so the header row can be matched flexibly
rather than assuming exact column names).

## Output target: OpenAir DOM
OpenAir's timesheet grid uses input IDs of the form:
- Hours input: `ts_c{col}_r{row}`
- Notes trigger (clickable cell that opens a dialog): `ts_notes_c{col}_r{row}`
- Notes textarea (inside the dialog that opens): `tm_notes`
- Notes dialog OK button: `.dialogOkButton`

`col` = day of week, 1 (Sunday) through 7 (Saturday). **Confirm this mapping
against the live page** — verify column 1 actually corresponds to the Sunday
input before shipping, since this was inferred from a working script rather
than direct inspection.

`row` = an OpenAir-internal row index. **It is not known in advance** — it has
to be resolved by matching the Excel row's `Client` + `Task` text against
whatever client/task labels appear in the actual OpenAir page for that user's
timesheet, since OpenAir uses dropdowns for Client/Task and row order is not
guaranteed to be stable or known ahead of time.

### Row resolution algorithm
1. Enumerate candidate rows by finding all elements matching
   `id^="ts_c1_r"` (col 1 is guaranteed present for every active row) and
   extracting the row number from each ID.
2. For each candidate row, find the nearest ancestor `<tr>` (or row container)
   and extract its visible text content (this will include the
   selected/displayed Client and Task dropdown values as rendered text).
3. Normalize text (lowercase, strip whitespace/punctuation) on both the
   OpenAir row text and the Excel `Client`/`Task` strings.
4. Score each candidate row against the Excel row using a simple string
   similarity measure (e.g. token overlap / Dice coefficient — no external
   library needed, write a small pure-JS function).
5. Decision logic:
   - One row scores clearly highest (e.g. score ≥ 0.8 and at least 0.2 above
     the next-best) → auto-match, no user input needed.
   - Multiple rows score closely (within ~0.15 of each other) → surface a
     disambiguation prompt: show the Excel row's Client/Task text and render
     a button per candidate OpenAir row (showing that row's actual label),
     plus a "Skip this row" button. Wait for the user's click before
     continuing to the next Excel row.
   - No row scores above a low threshold (e.g. < 0.3) → flag as unmatched in
     the preview table, do not silently guess.
6. Cache resolved matches for the session so the same Client/Task pairing
   isn't asked about twice if it repeats across multiple weeks of testing.

This matching step must run and fully resolve (including any user
disambiguation clicks) *before* the confirmation modal is shown, so the
preview table reflects final resolved rows.

## Confirmation modal (critical — do not skip or auto-fire)
After parsing + row resolution, render a modal (plain JS/DOM, no external UI
framework) showing a table with one row per parsed entry:
`Day | Client | Task | Hours | Notes (truncated) | Resolved OpenAir row`

Include "Confirm" and "Cancel" buttons. Only call the fill routine after
explicit Confirm. Any entry that failed to resolve a row should be visually
flagged (e.g. red background) and excluded from what gets written, with a
note telling the user to fix it in Excel and re-drag.

## Fill routine (adapt from existing working script, reuse the pattern below)
```js
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fillTimesheet(entries) {
  for (const entry of entries) {
    const inputId = `ts_c${entry.col}_r${entry.row}`;
    const notesId = `ts_notes_c${entry.col}_r${entry.row}`;
    const input = document.getElementById(inputId);
    if (!input || input.disabled) continue;

    input.value = entry.hours;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    if (entry.notes) {
      await delay(200);
      document.getElementById(notesId).click();
      await delay(350);
      const textarea = document.getElementById('tm_notes');
      if (textarea) {
        textarea.value = entry.notes;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await delay(200);
      document.querySelector('.dialogOkButton').click();
      await delay(200);
    }
  }
}
```
After completion, show a simple success toast/banner in the injected panel
(not just a console.log — the user can't see DevTools).

## Drop-zone UI
Inject a small fixed-position panel (e.g. bottom-right corner) on page load,
only when the timesheet grid is detected on the page (don't inject on other
OpenAir pages). Panel should:
- Accept native drag-and-drop (`dragover`, `drop` events) of a single `.xlsx`
  file.
- Also be clickable to open a standard file `<input type="file" accept=".xlsx">`
  picker, for users who find drag-and-drop unreliable.
- Reject non-`.xlsx` files with a clear inline message, not a silent failure.

## Error handling requirements
- If the Excel file can't be parsed (wrong format, missing expected headers),
  show a specific error in the panel — don't fail silently or only log to
  console, since the user has no visibility into DevTools.
- If OpenAir's expected DOM elements (`ts_c1_r*` etc.) aren't found at all on
  the page, show an error like "Timesheet grid not detected — make sure
  you're on the weekly timesheet entry page."
- Wrap the fill routine in try/catch per entry so one failure doesn't abort
  the whole batch; report which entries succeeded/failed in a final summary.

## Open items requiring confirmation against the real OpenAir page before shipping
1. Exact OpenAir host/URL pattern for `host_permissions` and `matches`.
2. Confirm `col` 1–7 really maps Sunday–Saturday in the live DOM (not just
   inferred from the existing script).
3. Confirm the actual HTML structure around `ts_c{col}_r{row}` inputs (is the
   nearest row container really a `<tr>`? Inspect via browser DevTools on a
   real timesheet page) so the row-text-extraction step in matching works.
4. Decide Chrome Web Store listing details (name, screenshots, privacy
   statement — required even for unlisted apps since the extension reads a
   local file and writes to a third-party site's DOM).

## Out of scope
- No OpenAir native import (confirmed not available for this org).
- No external server/backend — everything runs client-side in the extension.
- No `localStorage`/remote storage of timesheet data — process in-memory per
  session only, given this includes potentially sensitive work notes.
