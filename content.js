// content.js — OpenAir Timesheet Importer
// Injected on: https://connor-group.app.netsuitesuiteprojectspro.com/timesheet.pl
// Only activates when the timesheet grid (ts_c1_r*) is detected on the page.

(function () {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────────────────────

  const PANEL_ID = 'oai-panel';
  const GRID_SELECTOR = '[id^="ts_c3_r"]'; // col 3 = Sunday (confirmed)
  const GRID_DETECT_TIMEOUT = 15_000; // ms
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // OpenAir col mapping: day-of-week index (0=Sun) → OpenAir col number
  // Confirmed: col 3=Sunday, col 4=Monday, … col 9=Saturday
  const DOW_TO_OPENAIR_COL = [3, 4, 5, 6, 7, 8, 9]; // index = JS getDay()

  // Session cache: normalised "client task" key → resolved OpenAir rowNum
  const rowCache = new Map();

  // ─── Utilities ───────────────────────────────────────────────────────────────

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalise(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Sørensen–Dice coefficient on character bigrams. */
  function diceCoefficient(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;

    const bigrams = new Map();
    for (let i = 0; i < a.length - 1; i++) {
      const bg = a.slice(i, i + 2);
      bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
    }

    let hits = 0;
    for (let i = 0; i < b.length - 1; i++) {
      const bg = b.slice(i, i + 2);
      const n = bigrams.get(bg) || 0;
      if (n > 0) {
        hits++;
        bigrams.set(bg, n - 1);
      }
    }

    return (2 * hits) / (a.length + b.length - 2);
  }

  // ─── Panel ───────────────────────────────────────────────────────────────────

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="oai-header">
        <span class="oai-title">&#9200; Timesheet Importer</span>
      </div>
      <div class="oai-body">
        <div class="oai-dropzone" id="oai-dropzone" role="button" tabindex="0"
             aria-label="Drop Excel file or click to browse">
          <div class="oai-dropzone-icon">&#128196;</div>
          <div class="oai-dropzone-text">
            Drop your <strong>.xlsx</strong> here<br>
            or <span class="oai-link">click to browse</span>
          </div>
          <input type="file" id="oai-file-input" accept=".xlsx" style="display:none"
                 aria-label="Select Excel file">
        </div>
        <div class="oai-status" id="oai-status" role="status" aria-live="polite"></div>
      </div>
    `;
    document.body.appendChild(panel);
    return panel;
  }

  function setStatus(html, type = 'info') {
    const el = document.getElementById('oai-status');
    if (!el) return;
    el.className = `oai-status oai-status--${type}`;
    el.innerHTML = html;
  }

  function showDropzone() {
    const dz = document.getElementById('oai-dropzone');
    if (dz) dz.style.display = '';
  }

  function hideDropzone() {
    const dz = document.getElementById('oai-dropzone');
    if (dz) dz.style.display = 'none';
  }

  function setPanelLoading(msg) {
    hideDropzone();
    setStatus(`<span class="oai-spinner"></span> ${msg}`, 'info');
  }

  function resetPanel() {
    showDropzone();
    setStatus('');
  }

  // ─── Excel Parsing ───────────────────────────────────────────────────────────

  /**
   * Parse the uploaded .xlsx file into a list of time entries.
   *
   * Template structure (row 1):
   *   A: "Client : Engagement"
   *   B: "Task"
   *   C: Date (Sunday)  D: "notes"
   *   E: Date (Monday)  F: "notes"
   *   G: Date (Tuesday) H: "notes"
   *   I: Date (Wed)     J: "notes"
   *   K: Date (Thu)     L: "notes"
   *   M: Date (Fri)     N: "notes"
   *   O: Date (Sat)     P: "notes"
   *   Q: "Total"
   *
   * @param {ArrayBuffer} arrayBuffer
   * @returns {{ clientEngagement: string, task: string, hours: number,
   *             notes: string, col: number, dayName: string, row: number|null }[]}
   */
  function parseTimesheet(arrayBuffer) {
    const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });

    // Find the first sheet with "Client" in A1 (skip README etc.)
    let ws = null;
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      const a1 = sheet['A1'];
      if (a1 && typeof a1.v === 'string' && /client/i.test(a1.v)) {
        ws = sheet;
        break;
      }
    }
    if (!ws) {
      throw new Error(
        'Could not find a timesheet sheet. Make sure your file has a sheet ' +
        'with "Client" in cell A1.'
      );
    }

    // Get raw rows — Date cells come back as JS Date objects (cellDates: true)
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    if (!rows || rows.length < 2) {
      throw new Error('The timesheet sheet appears to be empty.');
    }

    const headerRow = rows[0];

    // Build the day-column map by scanning the header for Date values.
    // In the template the header cells at cols C, E, G, I, K, M, O are dates;
    // each is immediately followed by a "notes" column.
    const dayColumns = [];

    for (let i = 0; i < headerRow.length; i++) {
      const cell = headerRow[i];
      let date = null;

      if (cell instanceof Date) {
        date = cell;
      } else if (typeof cell === 'number' && cell > 40_000 && cell < 60_000) {
        // Excel date serial that wasn't converted (formula cache not present)
        date = new Date((cell - 25569) * 86400 * 1000);
      }

      if (date) {
        const dow = date.getDay(); // 0 = Sunday … 6 = Saturday
        dayColumns.push({
          excelIndex: i,
          openairCol: DOW_TO_OPENAIR_COL[dow],
          dayName: DAY_NAMES[dow],
          notesExcelIndex: i + 1,
        });
      }
    }

    // Positional fallback if header dates were not cached by Excel
    if (dayColumns.length === 0) {
      console.warn('[OAI] No date headers found — falling back to fixed column positions.');
      // Template: cols 2,4,6,8,10,12,14 = Sun…Sat hours
      [2, 4, 6, 8, 10, 12, 14].forEach((idx, pi) => {
        dayColumns.push({
          excelIndex: idx,
          openairCol: DOW_TO_OPENAIR_COL[pi],
          dayName: DAY_NAMES[pi],
          notesExcelIndex: idx + 1,
        });
      });
    }

    // Parse data rows (row index 1 onwards)
    const entries = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;

      const clientEngagement = String(row[0] || '').trim();
      const task = String(row[1] || '').trim();
      if (!clientEngagement && !task) continue;

      for (const { excelIndex, openairCol, dayName, notesExcelIndex } of dayColumns) {
        const hoursRaw = row[excelIndex];
        if (hoursRaw === null || hoursRaw === undefined || hoursRaw === '') continue;
        const hours = parseFloat(hoursRaw);
        if (isNaN(hours) || hours <= 0) continue;

        const notes = String(row[notesExcelIndex] || '').trim();
        entries.push({ clientEngagement, task, hours, notes, col: openairCol, dayName, row: null });
      }
    }

    if (entries.length === 0) {
      throw new Error(
        'No time entries found. Make sure you have filled in hours for at least one row.'
      );
    }

    return entries;
  }

  // ─── Row Resolution ──────────────────────────────────────────────────────────

  /** Collect all active OpenAir rows with their row numbers and visible text. */
  function enumerateCandidateRows() {
    const inputs = document.querySelectorAll(GRID_SELECTOR);
    const candidates = [];

    for (const input of inputs) {
      const m = input.id.match(/ts_c1_r(\d+)/);
      if (!m) continue;
      const rowNum = parseInt(m[1], 10);

      // Extract visible text from the row container (<tr> or nearest parent)
      const container = input.closest('tr') || input.parentElement;
      const text = container
        ? (container.innerText || container.textContent || '').replace(/\s+/g, ' ').trim()
        : '';

      candidates.push({ rowNum, text });
    }

    return candidates;
  }

  function scoreEntry(entry, rowText) {
    const query = normalise(`${entry.clientEngagement} ${entry.task}`);
    const target = normalise(rowText);
    return diceCoefficient(query, target);
  }

  /**
   * Show a disambiguation prompt and resolve to the selected rowNum (or null to skip).
   * @param {{ clientEngagement: string, task: string }} entry
   * @param {{ rowNum: number, text: string, score: number }[]} candidates
   * @returns {Promise<number|null>}
   */
  function promptDisambiguation(entry, candidates) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'oai-disambig-overlay';

      const box = document.createElement('div');
      box.className = 'oai-disambig-box';
      box.innerHTML = `
        <h3 class="oai-disambig-heading">Ambiguous match</h3>
        <p class="oai-disambig-desc">
          Which OpenAir row corresponds to:<br>
          <strong>${escapeHtml(entry.clientEngagement)} &mdash; ${escapeHtml(entry.task)}</strong>?
        </p>
        <div class="oai-disambig-candidates"></div>
        <button class="oai-btn oai-btn--secondary oai-disambig-skip">Skip this row</button>
      `;

      const candContainer = box.querySelector('.oai-disambig-candidates');
      for (const { rowNum, text, score } of candidates) {
        const btn = document.createElement('button');
        btn.className = 'oai-btn oai-btn--candidate';
        btn.textContent = text || `Row ${rowNum}`;
        btn.title = `Match score: ${(score * 100).toFixed(0)}%`;
        btn.onclick = () => {
          overlay.remove();
          resolve(rowNum);
        };
        candContainer.appendChild(btn);
      }

      box.querySelector('.oai-disambig-skip').onclick = () => {
        overlay.remove();
        resolve(null);
      };

      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

  /**
   * Resolve each entry to an OpenAir row number.
   * Handles auto-match, disambiguation, and unmatched cases.
   */
  async function resolveRows(entries) {
    const candidateRows = enumerateCandidateRows();

    if (candidateRows.length === 0) {
      throw new Error(
        'Timesheet grid rows not found. Make sure you’re on the weekly ' +
        'timesheet entry page and the grid is fully loaded.'
      );
    }

    // Local cache for this import pass (avoids re-asking for the same client/task)
    const passCache = new Map();
    const resolved = [];

    for (const entry of entries) {
      const cacheKey = normalise(`${entry.clientEngagement} ${entry.task}`);

      let rowNum;
      if (rowCache.has(cacheKey)) {
        rowNum = rowCache.get(cacheKey);
      } else if (passCache.has(cacheKey)) {
        rowNum = passCache.get(cacheKey);
      } else {
        const scored = candidateRows
          .map((c) => ({ ...c, score: scoreEntry(entry, c.text) }))
          .sort((a, b) => b.score - a.score);

        const best = scored[0];
        const second = scored[1];

        if (best.score >= 0.8 && (!second || best.score - second.score >= 0.2)) {
          // Clear winner — auto-match
          rowNum = best.rowNum;
        } else if (best.score >= 0.3) {
          // Ambiguous — ask user
          const closeEnough = scored.filter(
            (c) => c.score >= 0.3 && best.score - c.score < 0.15
          );
          rowNum = await promptDisambiguation(entry, closeEnough.slice(0, 5));
        } else {
          // No plausible match
          rowNum = null;
        }

        passCache.set(cacheKey, rowNum);
        if (rowNum !== null) rowCache.set(cacheKey, rowNum);
      }

      resolved.push({ ...entry, row: rowNum });
    }

    return resolved;
  }

  // ─── Confirmation Modal ──────────────────────────────────────────────────────

  /** Render the confirmation table and return a Promise<boolean>. */
  function showConfirmationModal(entries) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'oai-modal-overlay';

      const hasUnmatched = entries.some((e) => e.row === null);

      const tableRows = entries
        .map(
          (e) => `
          <tr class="${e.row === null ? 'oai-row--unmatched' : ''}">
            <td>${e.dayName}</td>
            <td>${escapeHtml(e.clientEngagement)}</td>
            <td>${escapeHtml(e.task)}</td>
            <td>${e.hours}</td>
            <td class="oai-notes-cell">${
              e.notes
                ? escapeHtml(e.notes.slice(0, 60)) + (e.notes.length > 60 ? '&hellip;' : '')
                : '&mdash;'
            }</td>
            <td>${
              e.row !== null
                ? `Row&nbsp;${e.row}`
                : '<span class="oai-unmatched-badge">Unmatched</span>'
            }</td>
          </tr>`
        )
        .join('');

      overlay.innerHTML = `
        <div class="oai-modal">
          <h2 class="oai-modal-title">Confirm Timesheet Entries</h2>
          ${
            hasUnmatched
              ? '<p class="oai-warning">&#9888; Unmatched rows (highlighted) will be skipped. ' +
                'Fix them in Excel and re-import.</p>'
              : ''
          }
          <div class="oai-table-wrap">
            <table class="oai-preview-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Client / Engagement</th>
                  <th>Task</th>
                  <th>Hours</th>
                  <th>Notes</th>
                  <th>OpenAir Row</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
          <div class="oai-modal-actions">
            <button class="oai-btn oai-btn--secondary" id="oai-cancel">Cancel</button>
            <button class="oai-btn oai-btn--primary" id="oai-confirm">
              Confirm &amp; Fill
            </button>
          </div>
        </div>
      `;

      overlay.querySelector('#oai-confirm').onclick = () => {
        overlay.remove();
        resolve(true);
      };
      overlay.querySelector('#oai-cancel').onclick = () => {
        overlay.remove();
        resolve(false);
      };

      document.body.appendChild(overlay);
    });
  }

  // ─── Fill Routine ─────────────────────────────────────────────────────────────

  /**
   * Write hours and notes into the OpenAir timesheet DOM.
   * Adapted from the existing working script pattern.
   * Wraps each entry individually so a single failure doesn't abort the batch.
   */
  async function fillTimesheet(entries) {
    const toFill = entries.filter((e) => e.row !== null);
    const results = {
      success: 0,
      failed: [],
      skipped: entries.length - toFill.length,
    };

    for (const entry of toFill) {
      try {
        const inputId = `ts_c${entry.col}_r${entry.row}`;
        const notesId = `ts_notes_c${entry.col}_r${entry.row}`;
        const input = document.getElementById(inputId);

        if (!input) {
          results.failed.push(`${entry.dayName} / ${escapeHtml(entry.task)}: input #${inputId} not found`);
          continue;
        }
        if (input.disabled) {
          results.failed.push(`${entry.dayName} / ${escapeHtml(entry.task)}: input is disabled`);
          continue;
        }

        input.value = entry.hours;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        if (entry.notes) {
          await delay(200);
          const notesEl = document.getElementById(notesId);
          if (notesEl) {
            notesEl.click();
            await delay(350);

            const textarea = document.getElementById('tm_notes');
            if (textarea) {
              textarea.value = entry.notes;
              textarea.dispatchEvent(new Event('input', { bubbles: true }));
              textarea.dispatchEvent(new Event('change', { bubbles: true }));
            }

            await delay(200);
            const okBtn = document.querySelector('.dialogOkButton');
            if (okBtn) okBtn.click();
            await delay(200);
          }
        }

        results.success++;
      } catch (err) {
        results.failed.push(
          `${entry.dayName} / ${escapeHtml(entry.task)}: ${err.message}`
        );
      }
    }

    return results;
  }

  // ─── HTML escape helper ───────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Main Flow ───────────────────────────────────────────────────────────────

  async function handleFile(file) {
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setStatus('Only <strong>.xlsx</strong> files are supported.', 'error');
      return;
    }

    try {
      setPanelLoading('Parsing Excel file…');
      const arrayBuffer = await file.arrayBuffer();
      const rawEntries = parseTimesheet(arrayBuffer);

      setPanelLoading(`Resolving ${rawEntries.length} entries against OpenAir rows…`);
      const resolved = await resolveRows(rawEntries);

      const confirmed = await showConfirmationModal(resolved);
      if (!confirmed) {
        resetPanel();
        return;
      }

      setPanelLoading('Filling timesheet…');
      const results = await fillTimesheet(resolved);

      // Build summary message
      const filledCount = results.success;
      let summary = `✅ <strong>${filledCount}</strong> entr${filledCount === 1 ? 'y' : 'ies'} filled.`;
      if (results.skipped > 0) {
        summary += ` <strong>${results.skipped}</strong> skipped (unmatched — fix in Excel and re-import).`;
      }
      if (results.failed.length > 0) {
        summary +=
          `<br>❌ ${results.failed.length} failed:<ul>` +
          results.failed.map((f) => `<li>${f}</li>`).join('') +
          '</ul>';
      }

      showDropzone();
      setStatus(summary, results.failed.length > 0 ? 'warning' : 'success');
    } catch (err) {
      showDropzone();
      setStatus(`❌ ${escapeHtml(err.message)}`, 'error');
    }
  }

  // ─── Initialisation ───────────────────────────────────────────────────────────

  /** Wait for the timesheet grid to appear in the DOM. */
  function waitForGrid() {
    return new Promise((resolve, reject) => {
      if (document.querySelector(GRID_SELECTOR)) {
        resolve();
        return;
      }

      const observer = new MutationObserver(() => {
        if (document.querySelector(GRID_SELECTOR)) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error('Grid not found'));
      }, GRID_DETECT_TIMEOUT);
    });
  }

  async function init() {
    // Only activate on timesheet.pl pages
    if (!window.location.pathname.includes('/timesheet.pl')) return;

    try {
      await waitForGrid();
    } catch {
      // Not a timesheet grid page — do nothing
      return;
    }

    // Avoid double-injection (e.g. after SPA navigations)
    if (document.getElementById(PANEL_ID)) return;

    createPanel();

    const dropzone = document.getElementById('oai-dropzone');
    const fileInput = document.getElementById('oai-file-input');

    // Click / keyboard → open file picker
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file) handleFile(file);
      fileInput.value = ''; // Reset so same file can be re-selected
    });

    // Drag-and-drop
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('oai-dropzone--active');
    });
    ['dragleave', 'dragend'].forEach((evt) => {
      dropzone.addEventListener(evt, () => dropzone.classList.remove('oai-dropzone--active'));
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('oai-dropzone--active');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
  }

  init();
})();
