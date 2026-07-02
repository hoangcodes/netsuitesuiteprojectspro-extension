// content.js -- OpenAir Timesheet Importer
// Injected into the OpenAir page. Manages the panel and fills the timesheet.

(function () {
  'use strict';

  // TEMP: cross-month "go to next month's timesheet" navigation is disabled while we
  // stabilise the single-month fill. Re-enable (set true) once that flow is solid.
  var CROSS_MONTH_ENABLED = false;

  const GRID_SEL   = '[id^="ts_c1_r"]';
  const DAY_NAMES  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOW_TO_COL = [3, 4, 5, 6, 7, 8, 9];
  const COL_TO_DOW = { 3:0, 4:1, 5:2, 6:3, 7:4, 8:5, 9:6 };
  const DAY_PATS   = [
    {re:/^sun/i,dow:0},{re:/^mon/i,dow:1},{re:/^tue/i,dow:2},
    {re:/^wed/i,dow:3},{re:/^thu/i,dow:4},{re:/^fri/i,dow:5},{re:/^sat/i,dow:6},
  ];

  const rowCache = new Map();
  let panelStatus = null;
  let _tooltipEl = null;
  let _tooltipTimer = null;

  // ── Theme ──────────────────────────────────────────────────────────────────
  // Theme is applied ONLY to .oai-panel and .oai-modal-overlay elements,
  // never to the host OpenAir page itself.

  var _themeMode  = 'light';
  var _themeColor = 'slate';

  var THEME_ACCENTS = {
    slate:  { hex: '#44536B', dark: '#303d50' },
    nam:    { hex: '#0166B1', dark: '#014E86' },
    wilson: { hex: '#F77737', dark: '#DD5E1E' },
    sias:   { hex: '#833AB4', dark: '#6B2E93' },
    coe:    { hex: '#075E54', dark: '#054A42' },
  };

  function buildThemeCSS(mode, accent) {
    var a = accent.hex, ad = accent.dark;
    // Expose the accent as CSS variables so content.css picks up the chosen colour
    // everywhere it used to hard-code slate (panel header, dropzone, spinner, etc.).
    var rootVars = ':root{--oai-accent:' + a + ';--oai-accent-dark:' + ad + ';--oai-accent-soft:' + a + '1a;}';
    // Accent overrides (all modes)
    var css = rootVars + '\n' + [
      '.oai-btn--primary{background:' + a + '!important;border-color:' + a + '!important}',
      '.oai-btn--primary:hover{background:' + ad + '!important;border-color:' + ad + '!important}',
      '.oai-conf-step-hint{background:' + a + '1a!important;color:' + a + '!important;border-color:' + a + '!important}',
      '.oai-select:focus{border-color:' + a + '!important;box-shadow:0 0 0 3px ' + a + '22!important}',
    ].join('\n');

    if (mode === 'light') return css;

    var isDark   = mode === 'dark';
    var bg       = isDark ? '#0f172a' : '#1a1a24';
    var surf     = isDark ? '#1e293b' : '#252530';
    var surfAlt  = isDark ? '#253047' : '#2e2e3e';
    var bdr      = isDark ? '#334155' : '#3a3a4a';
    var t1       = isDark ? '#f1f5f9' : '#e8e8f0';
    var t2       = isDark ? '#cbd5e1' : '#a8a8c0';
    var t3       = isDark ? '#94a3b8' : '#8888a0';

    return css + '\n' + [
      // Panel widget
      '#oai-panel{background:' + surf + '!important;border-color:' + bdr + '!important;color:' + t1 + '!important}',
      '#oai-panel .oai-header{border-color:' + bdr + '!important}',
      '#oai-panel .oai-header span,#oai-panel .oai-header svg{color:' + t1 + '!important}',
      '#oai-panel .oai-title{color:' + t1 + '!important}',
      '#oai-panel .oai-body{background:' + surf + '!important}',
      '#oai-panel p,#oai-panel small{color:' + t2 + '!important}',
      '.oai-dropzone{background:' + bg + '!important;border-color:' + bdr + '!important;color:' + t3 + '!important}',
      '.oai-dropzone-text{color:' + t3 + '!important}',
      '.oai-dz-sub{color:' + t3 + '!important}',
      '.oai-btn--download{background:' + surf + '!important;border-color:' + bdr + '!important;color:' + t2 + '!important}',
      '.oai-status{color:' + t2 + '!important}',
      // Modals (sheet picker + confirmation)
      '.oai-modal-overlay .oai-modal{background:' + surf + '!important;border-color:' + bdr + '!important}',
      '.oai-modal-header{background:' + bg + '!important;border-color:' + bdr + '!important}',
      '.oai-modal-title{color:' + t1 + '!important}',
      '.oai-modal-footer{background:' + bg + '!important;border-color:' + bdr + '!important}',
      '.oai-sort-btn{color:' + t2 + '!important}',
      '.oai-conf-header{background:' + bg + '!important;border-color:' + bdr + '!important}',
      '.oai-conf-title{color:' + t1 + '!important}',
      '.oai-conf-inner{background:' + surf + '!important}',
      '.oai-conf-actions{background:' + bg + '!important;border-color:' + bdr + '!important}',
      '.oai-conf-scroll{border-color:' + bdr + '!important}',
      '.oai-conf-table th{background:' + bg + '!important;color:' + t2 + '!important;border-color:' + bdr + '!important}',
      '.oai-conf-table td{background:' + surf + '!important;color:' + t1 + '!important;border-color:' + bdr + '!important}',
      '.oai-conf-table tr:nth-child(even) td{background:' + surfAlt + '!important}',
      '.oai-conf-hint{color:' + t3 + '!important}',
      '.oai-conf-hint strong{color:' + t2 + '!important}',
      '.oai-conf-step-hint{background:' + surf + '!important;color:#ffffff!important;border:1px dotted ' + a + '!important}',
      '.oai-conf-cross-month-warning{background:' + surfAlt + '!important;color:#fca5a5!important;border-color:' + bdr + '!important}',
      '.oai-conf-stats-banner{color:' + t3 + '!important}',
      '.oai-conf-sheet-label{color:' + t2 + '!important}',
      '.oai-conf-legend{color:' + t3 + '!important}',
      '.oai-conf-above-table{background:' + surf + '!important}',
      '.oai-modal-x{color:' + t2 + '!important}',
      '.oai-modal-x:hover{background:' + bdr + '!important;color:' + t1 + '!important}',
      '.oai-conf-sel{background:' + bg + '!important;border-color:' + bdr + '!important;color:' + t1 + '!important}',
      '.oai-btn--secondary{background:' + surf + '!important;border-color:' + bdr + '!important;color:' + t2 + '!important}',
      '.oai-btn--secondary:hover{background:' + surfAlt + '!important}',
      // Sheet picker list
      '.oai-sheet-list{background:' + surf + '!important}',
      '.oai-sheet-item{background:' + surf + '!important;border-color:' + bdr + '!important;color:' + t1 + '!important}',
      '.oai-sheet-item:hover{background:' + surfAlt + '!important}',
      // Completion modal + audit log (dark/cool need light, contrasting text)
      '.oai-completion-msg{color:' + t1 + '!important}',
      '.oai-gif-chance{color:' + t2 + '!important}',
      '.oai-audit{border-color:' + bdr + '!important}',
      '.oai-audit-title{color:' + t1 + '!important}',
      '.oai-audit-summary{color:' + t3 + '!important}',
      '.oai-audit-scroll{border-color:' + bdr + '!important}',
      '.oai-audit-table th{background:' + bg + '!important;color:' + t2 + '!important;border-color:' + bdr + '!important}',
      '.oai-audit-table td{background:' + surf + '!important;color:' + t1 + '!important;border-color:' + bdr + '!important}',
      '.oai-audit-reason{color:#fca5a5!important}',
    ].join('\n');
  }

  function applyContentTheme(color, mode) {
    _themeColor = color || 'slate';
    _themeMode  = mode  || 'light';
    var accent  = THEME_ACCENTS[_themeColor] || THEME_ACCENTS.slate;
    var css     = buildThemeCSS(_themeMode, accent);
    var el      = document.getElementById('oai-theme-style');
    if (!el) {
      el    = document.createElement('style');
      el.id = 'oai-theme-style';
      document.head.appendChild(el);
    }
    el.textContent = css;
  }

  // Read theme on content script load and react to future changes
  chrome.storage.sync.get(['oai_theme_color', 'oai_theme_mode'], function (prefs) {
    applyContentTheme(prefs.oai_theme_color, prefs.oai_theme_mode);
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'sync') return;
    var color = changes.oai_theme_color ? changes.oai_theme_color.newValue : _themeColor;
    var mode  = changes.oai_theme_mode  ? changes.oai_theme_mode.newValue  : _themeMode;
    applyContentTheme(color, mode);
  });

  // ── Utilities ──────────────────────────────────────────────────────────────

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Content scripts run in an isolated world, so setting window.onbeforeunload here does
  // NOT clear the PAGE's handler - OpenAir's "Leave site? Changes may not be saved" prompt
  // would still fire on our intentional reloads/navigations. page-helper.js runs in the
  // MAIN world and nulls the page's handler when it receives this event on the shared document.
  function clearBeforeUnload() {
    try { document.dispatchEvent(new CustomEvent('oai-clear-beforeunload')); } catch (_e) {}
  }

  function normalise(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function dice(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const m = new Map();
    for (let i = 0; i < a.length - 1; i++) {
      const k = a.slice(i, i + 2);
      m.set(k, (m.get(k) || 0) + 1);
    }
    let h = 0;
    for (let j = 0; j < b.length - 1; j++) {
      const k = b.slice(j, j + 2);
      const n = m.get(k) || 0;
      if (n > 0) { h++; m.set(k, n - 1); }
    }
    return (2 * h) / (a.length + b.length - 2);
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setStatus(html, type) {
    if (!panelStatus) return;
    panelStatus.innerHTML = html;
    panelStatus.className = 'oai-status oai-status--' + type;
  }

  function clearStatus() {
    if (!panelStatus) return;
    panelStatus.innerHTML = '';
    panelStatus.className = 'oai-status';
  }

  // ── Custom tooltip (200ms delay) ───────────────────────────────────────────

  function _getTooltipEl() {
    if (!_tooltipEl) {
      _tooltipEl = document.createElement('div');
      _tooltipEl.className = 'oai-tooltip';
      document.body.appendChild(_tooltipEl);
    }
    return _tooltipEl;
  }

  function attachTooltip(el, text) {
    el.addEventListener('mouseenter', function () {
      _tooltipTimer = setTimeout(function () {
        var tip = _getTooltipEl();
        tip.textContent = text;
        tip.classList.add('oai-tooltip--visible');
        var rect = el.getBoundingClientRect();
        var maxW = 240;
        var left = rect.left + rect.width / 2 - maxW / 2;
        left = Math.max(4, Math.min(left, window.innerWidth - maxW - 4));
        tip.style.left = left + 'px';
        tip.style.top  = (rect.bottom + window.scrollY + 6) + 'px';
      }, 200);
    });
    el.addEventListener('mouseleave', function () {
      clearTimeout(_tooltipTimer);
      _getTooltipEl().classList.remove('oai-tooltip--visible');
    });
  }

  function attachTooltips(container) {
    container.querySelectorAll('[data-oai-tip]').forEach(function (el) {
      attachTooltip(el, el.dataset.oaiTip);
    });
  }

  // ── Cross-month detection ──────────────────────────────────────────────────

  function detectCrossMonth() {
    var today    = new Date();
    var sunday   = new Date(today);
    sunday.setDate(today.getDate() - today.getDay());
    var saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    if (sunday.getMonth() !== saturday.getMonth()) {
      return { isCross: true, from: sunday, to: saturday };
    }
    return { isCross: false };
  }

  function formatCrossMonthDates(from, to) {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[from.getMonth()] + ' ' + from.getDate() + ' - ' +
           months[to.getMonth()]   + ' ' + to.getDate();
  }

  // ── OpenAir DOM helpers ────────────────────────────────────────────────────

  function enumerateCandidateRows() {
    var clientSelects = document.querySelectorAll('[id^="ts_c1_r"]');
    if (!clientSelects.length) return { rows: [], allOptions: [] };

    // Collect all options (keep _FIND -- filtered only during matching)
    var allOptions = Array.from(clientSelects[0].options)
      .filter(function (o) { return o.value && o.value !== ':'; })
      .map(function (o)    { return { value: o.value, label: o.text.trim() }; });

    var rows = [];
    clientSelects.forEach(function (sel) {
      var m = sel.id.match(/ts_c1_r(\d+)/);
      if (!m) return;
      var rowNum = parseInt(m[1], 10);
      var chosen = sel.options[sel.selectedIndex];
      if (chosen && chosen.value && chosen.value !== ':') {
        rows.push({ rowNum: rowNum, value: chosen.value, label: chosen.text.trim() });
      }
    });
    return { rows: rows, allOptions: allOptions };
  }

  function enumerateTaskOptions(rowNum) {
    var sel = document.getElementById('ts_c2_r' + rowNum);
    if (!sel) return [];
    return Array.from(sel.options)
      .filter(function (o) { return o.value && o.value !== '_FIND' && o.value !== ':' && o.value !== '' && o.value !== '0'; })
      .map(function (o)    { return { value: o.value, label: o.text.trim() }; });
  }

  // ── Fill helpers ───────────────────────────────────────────────────────────

  // Builds one OpenAir row per Client:Engagement value. OpenAir auto-loads a row's
  // Task options AND spawns the next empty row the instant a Client:Engagement is
  // committed on the empty-row control, so we simply commit each value in turn - no
  // "duplicate row" dance (which never triggered the task load and left tasks empty).
  // Returns an array parallel to ceValues giving the REAL OpenAir row number for each
  // value (null for blank/skipped), so callers never assume rows are 1..N sequential.
  async function exposeAndFillClientEngagement(ceValues) {
    var rowNums = [];
    if (!ceValues || ceValues.length === 0) return rowNums;

    for (var i = 0; i < ceValues.length; i++) {
      var ceVal = ceValues[i];

      if (!ceVal || ceVal === '' || ceVal === ':') {
        // Edge case: the user left this Client:Engagement blank in the modal. We can't
        // commit a value, so - as in the original logic - spawn a placeholder row with
        // the "Add duplicate row below" button instead of skipping it, so the row still
        // exists and stays aligned with the modal (the user can pick its C:E manually).
        var beforeIds = new Set(Array.from(document.querySelectorAll('[id^="ts_c1_r"]')).map(function (s) { return s.id; }));
        var dupBtn = document.querySelector('a[aria-label="Add duplicate row below"]');
        if (!dupBtn) { rowNums.push(null); continue; }
        dupBtn.click();
        var addedRow = null;
        for (var b = 0; b < 60; b++) {
          await delay(100);
          var nw = Array.from(document.querySelectorAll('[id^="ts_c1_r"]')).find(function (s) { return !beforeIds.has(s.id); });
          if (nw) { var mm = nw.id.match(/ts_c1_r(\d+)/); addedRow = mm ? parseInt(mm[1], 10) : null; break; }
        }
        rowNums.push(addedRow);
        continue;
      }

      // Current empty-row Client:Engagement control (OpenAir always keeps exactly one).
      var emptyRow = Array.from(document.querySelectorAll('[id^="ts_c1_r"]'))
        .find(function (s) { return /timesheetEmptyRowControl/.test(s.className); });
      if (!emptyRow) throw new Error('Timesheet empty row control not found - are you on the weekly timesheet page?');

      var m = emptyRow.id.match(/ts_c1_r(\d+)/);
      var rowNum = m ? parseInt(m[1], 10) : null;
      var prevRowCount = document.querySelectorAll('[id^="ts_c1_r"]').length;

      // Commit it - OpenAir loads this row's Task options and spawns the next empty row.
      emptyRow.value = ceVal;
      emptyRow.dispatchEvent(new Event('input',  { bubbles: true }));
      emptyRow.dispatchEvent(new Event('change', { bubbles: true }));

      // Wait until a fresh empty row appears (confirms this row committed) or timeout.
      // Poll finely (100ms) so we continue the instant OpenAir spawns the next row.
      for (var w = 0; w < 60; w++) {           // up to ~6s
        await delay(100);
        if (document.querySelectorAll('[id^="ts_c1_r"]').length > prevRowCount) break;
      }
      rowNums.push(rowNum);
    }

    await delay(200); // let the last row's Task options finish loading
    return rowNums;
  }

  async function fillTimesheet(entries) {
    var results = { success: 0, failed: [], skipped: 0 };
    for (var entry of entries) {
      if (!entry.row) { results.skipped++; continue; }
      try {
        var inputId = 'ts_c' + entry.col + '_r' + entry.row;
        var notesId = 'ts_notes_c' + entry.col + '_r' + entry.row;
        var input   = document.getElementById(inputId);
        if (!input)         { results.failed.push({ day: entry.dayName, client: entry.clientEngagement, reason: 'cell not found on page' }); continue; }
        if (input.disabled) { results.failed.push({ day: entry.dayName, client: entry.clientEngagement, reason: 'input disabled (day may belong to another month)' }); continue; }
        input.value = entry.hours;
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (entry.notes) {
          await delay(100);
          var notesEl = document.getElementById(notesId);
          if (notesEl) {
            notesEl.click();
            await delay(250);
            var ta = document.getElementById('tm_notes');
            if (ta) {
              ta.value = entry.notes;
              ta.dispatchEvent(new Event('input',  { bubbles: true }));
              ta.dispatchEvent(new Event('change', { bubbles: true }));
            }
            await delay(100);
            var ok = document.querySelector('.dialogOkButton');
            if (ok) ok.click();
            await delay(100);
          }
        }
        results.success++;
      } catch (err) {
        results.failed.push({ day: entry.dayName || '?', client: entry.clientEngagement || '', reason: err.message });
      }
    }
    return results;
  }

  // Find a row's "Open Code Pending" task option value (label like "1: Open Code Pending").
  // Matched from that row's own live options, so the correct per-engagement task id is used.
  function findOpenCodePendingTask(taskOpts) {
    var norm = function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); };
    var strip = function (lbl) { return norm(String(lbl).replace(/^\s*\d+\s*:\s*/, '')); };
    var opts = taskOpts || [];
    var hit = opts.find(function (o) { return strip(o.label) === 'open code pending'; }) ||
              opts.find(function (o) { return norm(o.label).indexOf('open code pending') >= 0; });
    return hit ? hit.value : null;
  }

  async function fillTasksAndHours(entries, taskMap) {
    var seen = new Set();
    for (var e of entries) {
      var rowNum = e.row;
      if (!rowNum || seen.has(rowNum)) continue;
      seen.add(rowNum);
      var taskVal = taskMap.get(rowNum);
      // Edge case: task left blank -> default to this row's "Open Code Pending" task.
      if (!taskVal) taskVal = findOpenCodePendingTask(enumerateTaskOptions(rowNum));
      if (taskVal) {
        var sel = document.getElementById('ts_c2_r' + rowNum);
        if (sel) {
          sel.value = taskVal;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          await delay(200);
        }
      }
    }
    return fillTimesheet(entries);
  }

  // ── Excel parsing ──────────────────────────────────────────────────────────

  function detectDow(cell) {
    if (cell instanceof Date) return cell.getDay();
    if (typeof cell === 'number' && cell > 40000 && cell < 60000)
      return new Date((cell - 25569) * 86400 * 1000).getUTCDay();
    if (typeof cell === 'string') {
      var t = cell.trim();
      for (var p of DAY_PATS) if (p.re.test(t)) return p.dow;
    }
    return -1;
  }

  function parseSheet(wb, sheetName) {
    var ws = wb.Sheets[sheetName];
    if (!ws) throw new Error('Sheet "' + sheetName + '" not found.');
    var a1 = ws['A1'];
    if (!a1 || !/client/i.test(String(a1.v || '')))
      throw new Error('Cell A1 must say "Client : Engagement". Is this the right sheet?');
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    if (!rows || rows.length < 2) throw new Error('Sheet appears empty.');
    var header  = rows[0];
    var dayCols = [];
    for (var i = 0; i < header.length; i++) {
      var dow = detectDow(header[i]);
      if (dow >= 0) dayCols.push({ idx: i, col: DOW_TO_COL[dow], day: DAY_NAMES[dow], notesIdx: i + 1 });
    }
    if (dayCols.length === 0)
      [2,4,6,8,10,12,14].forEach(function (pos, d) {
        dayCols.push({ idx: pos, col: DOW_TO_COL[d], day: DAY_NAMES[d], notesIdx: pos + 1 });
      });

    var entries = []; var skippedCells = 0;
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r]; if (!row) continue;
      var client = String(row[0] || '').trim();
      var task   = String(row[1] || '').trim();
      if (!client && !task) continue;
      if (/^total/i.test(client)) continue;
      for (var dc of dayCols) {
        var raw = row[dc.idx];
        if (raw === null || raw === undefined || raw === '') { skippedCells++; continue; }
        var hours = parseFloat(raw);
        if (isNaN(hours) || hours <= 0) { skippedCells++; continue; }
        var notes = String(row[dc.notesIdx] || '').trim();
        entries.push({ clientEngagement: client, task: task, hours: hours, notes: notes,
                       col: dc.col, dayName: dc.day, row: null });
      }
    }
    if (entries.length === 0) throw new Error('No time entries found. Check hours are filled in.');
    return { entries: entries, skippedCells: skippedCells };
  }

  // ── Match scoring ──────────────────────────────────────────────────────────
  // Scores the Excel client name against one OpenAir option label.
  // ONLY uses the client:engagement cell from Excel - never the task column.
  // This prevents "Cerebras" matching "Crexi" just because they share a task suffix.

  function scoreMatch(clientKey, normLabel) {
    if (!clientKey || !normLabel) return 0;
    // Exact match
    if (clientKey === normLabel) return 1.0;
    // Label starts with the full client key (e.g. "Empyrean" -> "Empyrean : Project X")
    if (normLabel.startsWith(clientKey + ' ') || normLabel.startsWith(clientKey + ':')) return 0.95;
    // All significant client words appear in the label
    var clientWords = clientKey.split(' ').filter(function (w) { return w.length > 2; });
    var labelWords  = normLabel.split(' ');
    if (clientWords.length > 0 &&
        clientWords.every(function (w) { return labelWords.indexOf(w) >= 0; })) return 0.9;
    // Client key is a substring of the label (at least 4 chars to avoid noise)
    if (clientKey.length >= 4 && normLabel.indexOf(clientKey) >= 0) return 0.85;
    // Dice coefficient on client name only
    return dice(clientKey, normLabel);
  }

  // Scores an Excel task string against the live OpenAir task option labels and
  // returns the best-matching option value, or null if nothing clears threshold.
  // OpenAir task labels carry an ID prefix like "26: Phase 3 …" - strip it before
  // scoring so the free-text Excel task can match. Mirrors the Client:Engagement
  // matching (scoreMatch + 0.4 threshold).
  function resolveTaskForRow(taskText, taskOpts) {
    if (!taskText || !taskOpts || taskOpts.length === 0) return null;
    var taskKey = normalise(taskText);
    if (!taskKey) return null;
    var best = null, bestScore = 0;
    for (var o of taskOpts) {
      var lbl = normalise(String(o.label).replace(/^\s*\d+\s*:\s*/, ''));
      var s = scoreMatch(taskKey, lbl);
      if (s > bestScore) { bestScore = s; best = o; }
    }
    return (best && bestScore >= 0.4) ? best.value : null;
  }

  // ── Row resolution ─────────────────────────────────────────────────────────
  // Handles duplicate client:engagement rows (each gets a distinct OpenAir rowNum).
  // Cache is keyed by client name only so multiple tasks under the same client
  // all resolve to the same option value.

  function resolveRows(rawEntries, existingRows, allOptions) {
    var matchOptions = allOptions.filter(function (o) { return o.value !== '_FIND'; });
    var passCache    = new Map(); // clientKey -> optionValue
    var usedRowNums  = new Set(); // OpenAir rowNums already assigned this pass

    return rawEntries.map(function (entry) {
      var clientKey = normalise(entry.clientEngagement); // match on C:E only, NOT task

      var optVal, optLabel;

      if (rowCache.has(clientKey)) {
        optVal = rowCache.get(clientKey);
        var rc = matchOptions.find(function (o) { return o.value === optVal; });
        optLabel = rc ? rc.label : optVal;
      } else if (passCache.has(clientKey)) {
        optVal = passCache.get(clientKey);
        var pc = matchOptions.find(function (o) { return o.value === optVal; });
        optLabel = pc ? pc.label : optVal;
      } else {
        var bestOpt = null, bestScore = 0;
        for (var opt of matchOptions) {
          var s = scoreMatch(clientKey, normalise(opt.label));
          if (s > bestScore) { bestScore = s; bestOpt = opt; }
        }
        // Require ≥ 0.4 to avoid spurious matches from short shared substrings
        optVal   = (bestOpt && bestScore >= 0.4) ? bestOpt.value : null;
        optLabel = (bestOpt && bestScore >= 0.4) ? bestOpt.label : null;
        passCache.set(clientKey, optVal);
      }

      // Find an OpenAir row with this optionValue not yet used in this pass
      var existRow = optVal
        ? existingRows.find(function (r) { return r.value === optVal && !usedRowNums.has(r.rowNum); })
        : null;
      if (existRow) usedRowNums.add(existRow.rowNum);

      return Object.assign({}, entry, {
        matchedValue: optVal,
        matchedLabel: optLabel,
        row: existRow ? existRow.rowNum : null,
      });
    });
  }

  // ── Sheet picker modal ─────────────────────────────────────────────────────

  function showSheetPicker(names) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'oai-modal-overlay';

      var modal = document.createElement('div');
      modal.className = 'oai-modal oai-modal--sheet';
      modal.innerHTML =
        '<div class="oai-modal-header">' +
          '<span class="oai-modal-title">Select Worksheet</span>' +
          '<div class="oai-modal-header-right">' +
            '<button class="oai-sort-btn" id="oai-sheet-sort" title="Toggle sort order">' +
              '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l4-4 4 4"/><path d="M7 5v14"/><path d="M21 15l-4 4-4-4"/><path d="M17 19V5"/></svg>' +
            '</button>' +
            '<button class="oai-modal-x" id="oai-sheet-x" aria-label="Close">&times;</button>' +
          '</div>' +
        '</div>' +
        '<div class="oai-sheet-list" id="oai-sheet-list"></div>';
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      var selected  = null;
      var sortAsc   = false;
      var list      = modal.querySelector('#oai-sheet-list');
      var sortBtn   = modal.querySelector('#oai-sheet-sort');

      function renderList() {
        list.innerHTML = '';
        var sorted = sortAsc ? names.slice() : names.slice().reverse();
        sorted.forEach(function (name) {
          var btn = document.createElement('button');
          btn.className = 'oai-sheet-item' + (name === selected ? ' oai-sheet-item--selected' : '');
          btn.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:#64748b"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
            '<span>' + esc(name) + '</span>';
          btn.addEventListener('click', function () {
            document.body.removeChild(overlay);
            resolve(name);
          });
          list.appendChild(btn);
        });
      }

      renderList();
      sortBtn.addEventListener('click', function () { sortAsc = !sortAsc; renderList(); });
      modal.querySelector('#oai-sheet-x').addEventListener('click', function () { document.body.removeChild(overlay); resolve(null); });
    });
  }

  // ── Grid HTML builders ─────────────────────────────────────────────────────

  function _buildDayRows(rowKeys, rowMap) {
    // Shared pivot builder -- returns { html, dayTotals, grandTotal }
    var dayTotals  = [0,0,0,0,0,0,0];
    var grandTotal = 0;
    var html       = '';

    for (var key of rowKeys) {
      var r        = rowMap.get(key);
      var rowTotal = r.days.reduce(function (s, d) { return s + (d ? d.hours : 0); }, 0);
      grandTotal  += rowTotal;

      html += '<tr class="oai-conf-row" data-key="' + esc(key) + '">';
      // Client:Engagement cell placeholder -- caller fills this
      html += r._clientCellHtml;

      for (var d = 0; d < 7; d++) {
        var cell = r.days[d];
        if (cell && cell.hours > 0) {
          dayTotals[d] += cell.hours;
          var tipText = cell.notes || 'No notes';
          var ind = cell.notes
            ? '<span class="oai-conf-ind oai-conf-ind--yes" data-oai-tip="Notes present">&#10003;</span>'
            : '<span class="oai-conf-ind oai-conf-ind--no"  data-oai-tip="No notes">&#10005;</span>';
          html += '<td class="oai-conf-td oai-conf-td--hours oai-conf-td--filled" data-oai-tip="' + esc(tipText) + '"><span class="oai-cell-content">' + cell.hours.toFixed(2) + ind + '</span></td>';
        } else {
          html += '<td class="oai-conf-td oai-conf-td--hours oai-conf-td--empty">&mdash;</td>';
        }
      }
      html += '<td class="oai-conf-td oai-conf-td--rowtotal">' + (rowTotal > 0 ? rowTotal.toFixed(2) : '') + '</td>';
      html += '</tr>';
    }
    return { html: html, dayTotals: dayTotals, grandTotal: grandTotal };
  }

  function _footerRow(dayTotals, grandTotal, extraLeadCols) {
    var html = '<tr class="oai-conf-row-footer">';
    for (var x = 0; x < extraLeadCols; x++) {
      html += x === extraLeadCols - 1
        ? '<td class="oai-conf-td oai-conf-td--footer-label">TOTAL</td>'
        : '<td class="oai-conf-td oai-conf-td--footer-label"></td>';
    }
    for (var d = 0; d < 7; d++) {
      var t = dayTotals[d];
      html += t > 0
        ? '<td class="oai-conf-td oai-conf-td--daytotal">' + t.toFixed(2) + '</td>'
        : '<td class="oai-conf-td oai-conf-td--daytotal oai-conf-td--empty">&mdash;</td>';
    }
    html += '<td class="oai-conf-td oai-conf-td--grandtotal">' + grandTotal.toFixed(2) + '</td></tr>';
    return html;
  }

  var LEGEND_HTML =
    '<div class="oai-conf-legend">' +
      '<span><span class="oai-conf-ind oai-conf-ind--yes">&#10003;</span> Notes present</span>' +
      '<span><span class="oai-conf-ind oai-conf-ind--no">&#10005;</span> No notes</span>' +
    '</div>';

  function _statsHtml(stats) {
    return '<div class="oai-conf-stats-banner">Found <strong>' + stats.entries +
      '</strong> time entries for <strong>' + stats.dataRows +
      '</strong> client/task row(s). Skipped <strong>' + stats.skippedCells + '</strong> empty cells.</div>';
  }

  // Phase 1 grid: Client:Engagement dropdown | Sun-Sat | Total
  function buildPhase1Grid(entries, allOptions, matchMap, stats) {
    var rowKeys = [], rowMap = new Map();
    for (var e of entries) {
      var key = e.clientEngagement + '\x00' + e.task;
      if (!rowMap.has(key)) {
        rowKeys.push(key);
        rowMap.set(key, { client: e.clientEngagement, task: e.task, days: new Array(7).fill(null), _clientCellHtml: '' });
      }
      var rec = rowMap.get(key);
      var dow = COL_TO_DOW[e.col];
      if (dow !== undefined) rec.days[dow] = { hours: e.hours, notes: e.notes };
    }

    var regularOpts = allOptions.filter(function (o) { return o.value !== '_FIND'; });

    // Build client cell HTML per row
    for (var key of rowKeys) {
      var r = rowMap.get(key);
      if (regularOpts.length === 0) {
        r._clientCellHtml = '<td class="oai-conf-td oai-conf-td--client oai-conf-td--plaintext">' + esc(r.client) + '</td>';
      } else {
        var curVal = matchMap.get(key);
        var opts   = '<option value="">- leave blank for import -</option>';
        for (var o of regularOpts) {
          opts += '<option value="' + esc(o.value) + '"' + (o.value === curVal ? ' selected' : '') + '>' + esc(o.label) + '</option>';
        }
        // Note: "Find more..." (_FIND) is intentionally omitted. The native OpenAir dialog
        // cannot reliably appear above the injected modal overlay due to CSS stacking context
        // constraints - the injected overlay owns its own stacking context and blocks native
        // dialogs from rendering on top of it, regardless of z-index on child elements.
        r._clientCellHtml = '<td class="oai-conf-td oai-conf-td--client"><select class="oai-conf-sel oai-conf-sel--client" data-key="' + esc(key) + '">' + opts + '</select></td>';
      }
    }

    var body   = _buildDayRows(rowKeys, rowMap);
    var footer = _footerRow(body.dayTotals, body.grandTotal, 1);

    return '<div class="oai-conf-hint-legend-row">' +
        '<div class="oai-conf-step-hint">' +
          'Step 1: Review <strong>Client : Engagement</strong> column, time, and notes<br>' +
          '- If you can\'t find your <strong>Client : Engagement</strong>, leave as blank' +
        '</div>' +
        '<div class="oai-conf-right-col">' +
          (stats._fileName || stats._sheetName ? '<div class="oai-conf-sheet-label">' + (stats._fileName ? 'file name: <strong>' + esc(stats._fileName) + '</strong><br>' : '') + 'sheet name: <strong>' + esc(stats._sheetName || '') + '</strong>' + '</div>' : '') +
          LEGEND_HTML +
        '</div>' +
      '</div>' +
      '<div class="oai-conf-scroll"><table class="oai-conf-table"><thead><tr>' +
      '<th class="oai-conf-th oai-conf-th--client">CLIENT : ENGAGEMENT</th>' +
      DAY_NAMES.map(function (d) { return '<th class="oai-conf-th oai-conf-th--day">' + d.toUpperCase() + '</th>'; }).join('') +
      '<th class="oai-conf-th oai-conf-th--total">TOTAL</th>' +
      '</tr></thead><tbody>' + body.html + footer + '</tbody></table></div>' +
      _statsHtml(stats);
  }

  // Phase 2 grid: Client:Engagement (read-only) | Task dropdown | Sun-Sat | Total
  function buildPhase2Grid(entries, rowTaskOptions, taskMap, meta) {
    var rowKeys = [], rowMap = new Map();
    for (var e of entries) {
      var key = e.clientEngagement + '\x00' + e.task;
      if (!rowMap.has(key)) {
        rowKeys.push(key);
        rowMap.set(key, {
          client:       e.clientEngagement,
          task:         e.task,
          matchedLabel: e.matchedLabel,
          row:          e.row,
          days:         new Array(7).fill(null),
          _clientCellHtml: '',
        });
      }
      var rec = rowMap.get(key);
      var dow = COL_TO_DOW[e.col];
      if (dow !== undefined) rec.days[dow] = { hours: e.hours, notes: e.notes };
    }

    // Build client+task cells per row
    for (var key of rowKeys) {
      var r        = rowMap.get(key);
      var taskOpts = r.row ? (rowTaskOptions.get(r.row) || []) : [];
      var curTask  = taskMap.get(r.row) || '';
      if (!curTask && taskOpts.length > 0) {
        var _autoTask = resolveTaskForRow(r.task, taskOpts);
        if (_autoTask) { curTask = _autoTask; if (r.row) taskMap.set(r.row, _autoTask); }
      }

      // Client:Engagement -- read-only
      r._clientCellHtml = '<td class="oai-conf-td oai-conf-td--client oai-conf-td--readonly">' + esc(r.matchedLabel || r.client) + '</td>';

      // Task dropdown - always render a select; mark as data-loading if options not yet available
      var _taskLoading = taskOpts.length === 0;
      var opts = '<option value="">- leave blank for import -</option>';
      for (var o of taskOpts) {
        opts += '<option value="' + esc(o.value) + '"' + (o.value === curTask ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      }
      r._clientCellHtml += '<td class="oai-conf-td oai-conf-td--task' + (_taskLoading ? ' oai-conf-td--task-loading' : '') + '">' +
        '<select class="oai-conf-sel oai-conf-sel--task" data-row="' + (r.row || '') + '"' + (_taskLoading ? ' data-loading="1"' : '') + '>' +
        opts + '</select></td>';
    }

    var body   = _buildDayRows(rowKeys, rowMap);
    var footer = _footerRow(body.dayTotals, body.grandTotal, 2);

    var _metaLabel = (meta && (meta.fileName || meta.sheetName))
      ? '<div class="oai-conf-sheet-label">' + (meta.fileName ? 'file name: <strong>' + esc(meta.fileName) + '</strong><br>' : '') + 'sheet name: <strong>' + esc(meta.sheetName || '') + '</strong>' + '</div>'
      : '';
    return '<div class="oai-conf-hint-legend-row">' +
        '<div class="oai-conf-step-hint oai-conf-step-hint--bottom">' +
          'Step 2: Review <strong>Task</strong> - if you can\'t find your Task, leave as blank' +
        '</div>' +
        '<div class="oai-conf-right-col">' +
          _metaLabel +
          LEGEND_HTML +
        '</div>' +
      '</div>' +
      '<div class="oai-conf-scroll"><table class="oai-conf-table"><thead><tr>' +
      '<th class="oai-conf-th oai-conf-th--client">CLIENT : ENGAGEMENT</th>' +
      '<th class="oai-conf-th oai-conf-th--task">TASK</th>' +
      DAY_NAMES.map(function (d) { return '<th class="oai-conf-th oai-conf-th--day">' + d.toUpperCase() + '</th>'; }).join('') +
      '<th class="oai-conf-th oai-conf-th--total">TOTAL</th>' +
      '</tr></thead><tbody>' + body.html + footer + '</tbody></table></div>' +
      (meta && meta.stats ? _statsHtml(meta.stats) : '');
  }

  // ── _FIND handler ──────────────────────────────────────────────────────────

  function handleFindMore(key, ourSel, matchMap, overlay) {
    // Use an unset OpenAir row as a scratch select for the find dialog
    var pageSelects = Array.from(document.querySelectorAll('[id^="ts_c1_r"]'));
    var scratchSel  = pageSelects.find(function (s) { return !s.value || s.value === ':'; }) || pageSelects[0];
    if (!scratchSel) { ourSel.value = matchMap.get(key) || ''; return; }

    // Make overlay transparent so user can interact with OpenAir's dialog
    overlay.classList.add('oai-modal-overlay--passthrough');

    var prevVal = scratchSel.value;
    scratchSel.value = '_FIND';
    scratchSel.dispatchEvent(new Event('change', { bubbles: true }));

    var polls = 0;
    var iv = setInterval(function () {
      polls++;
      var newVal = scratchSel.value;
      var done   = (newVal !== '_FIND' && newVal !== prevVal) || polls > 300;
      if (!done) return;
      clearInterval(iv);
      overlay.classList.remove('oai-modal-overlay--passthrough');

      if (newVal && newVal !== '_FIND' && newVal !== prevVal) {
        // Add option to our dropdown if it isn't there already
        var existing = Array.from(ourSel.options).find(function (o) { return o.value === newVal; });
        if (!existing) {
          var pageOpt = Array.from(scratchSel.options).find(function (o) { return o.value === newVal; });
          var newOpt  = document.createElement('option');
          newOpt.value = newVal;
          newOpt.text  = pageOpt ? pageOpt.text : newVal;
          var findOpt  = ourSel.querySelector('option[value="_FIND"]');
          ourSel.insertBefore(newOpt, findOpt || null);
        }
        ourSel.value = newVal;
        matchMap.set(key, newVal);

        // Restore scratch row
        scratchSel.value = prevVal;
        if (prevVal) scratchSel.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // Cancelled -- revert our select and restore scratch
        ourSel.value = matchMap.get(key) || '';
        scratchSel.value = prevVal;
        if (prevVal) scratchSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, 200);
  }

  function attachPhase1Events(container, matchMap, overlay) {
    container.querySelectorAll('.oai-conf-sel--client').forEach(function (sel) {
      var key = sel.dataset.key;
      if (sel.value) matchMap.set(key, sel.value);
      sel.addEventListener('change', function () {
        if (this.value === '_FIND') {
          handleFindMore(key, this, matchMap, overlay);
          return;
        }
        matchMap.set(key, this.value || null);
      });
    });
  }


  // ── Save / navigation helpers ──────────────────────────────────────────────

  // Poll until all given row task selects have loaded options (or timeout)
  async function waitForTaskOptions(rowNums, timeoutMs) {
    timeoutMs = timeoutMs || 10000;
    var start = Date.now();
    while (Date.now() - start < timeoutMs) {
      var ready = rowNums.every(function (r) {
        var sel = document.getElementById('ts_c2_r' + r);
        return sel && sel.options.length > 1;
      });
      if (ready) break;
      await delay(100);
    }
    await delay(100); // small buffer after options appear
  }

  // Poll until the timesheet grid reappears (after page navigation)
  async function waitForTimesheetGrid(timeoutMs) {
    timeoutMs = timeoutMs || 10000;
    var start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (document.querySelector(GRID_SEL)) return;
      await delay(300);
    }
    throw new Error('Timed out waiting for timesheet grid to load.');
  }

  // Click the "Go to [next month] timesheet" link OpenAir shows after a cross-month save
  async function clickNextMonthLink() {
    var link = Array.from(document.querySelectorAll('a,button,input[type="button"]')).find(function (el) {
      return /go to.+timesheet/i.test((el.textContent || el.value || '').trim());
    });
    if (!link) throw new Error('"Go to next month timesheet" link not found. Please navigate manually.');
    clearBeforeUnload();
    link.click();
    await delay(500);
  }

  // Completion modal. `results` = { success, failed:[{day,client,reason}], skipped }.
  // The Audit Log only appears when something failed. 'surprise' rolls an emote in place.
  function showCompletionModal(results) {
    return new Promise(function (resolve) {
      var failed = (results && results.failed) ? results.failed : [];
      var hasFailures = failed.length > 0;

      var auditHtml = '';
      if (hasFailures) {
        var rowsHtml = failed.map(function (f) {
          return '<tr>' +
            '<td class="oai-audit-day">' + esc(f.day || '') + '</td>' +
            '<td class="oai-audit-client">' + esc(f.client || '') + '</td>' +
            '<td class="oai-audit-reason">' + esc(f.reason || '') + '</td>' +
          '</tr>';
        }).join('');
        var summary = esc(failed.length + ' ' + (failed.length === 1 ? 'entry' : 'entries') + ' could not be entered');
        auditHtml =
          '<div class="oai-audit">' +
            '<div class="oai-audit-title">Audit Log</div>' +
            '<div class="oai-audit-summary">' + summary + '</div>' +
            '<div class="oai-audit-scroll"><table class="oai-audit-table">' +
              '<thead><tr><th>Day</th><th>Client : Engagement</th><th>Issue</th></tr></thead>' +
              '<tbody>' + rowsHtml + '</tbody>' +
            '</table></div>' +
          '</div>';
      }

      var overlay = document.createElement('div');
      overlay.className = 'oai-modal-overlay';
      var modal = document.createElement('div');
      modal.className = 'oai-modal oai-modal--completion';
      modal.innerHTML =
        '<div class="oai-conf-header">' +
          '<span class="oai-conf-title">Complete</span>' +
        '</div>' +
        '<div class="oai-completion-body">' +
          '<div class="oai-completion-icon">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
          '</div>' +
          '<p class="oai-completion-msg">thank you for using the extension</p>' +
          auditHtml +
        '</div>' +
        '<div class="oai-conf-actions">' +
          '<button class="oai-btn oai-btn--secondary" id="oai-surprise">surprise</button>' +
          '<div class="oai-conf-buttons">' +
            '<button class="oai-btn oai-btn--primary" id="oai-done-close">Close</button>' +
          '</div>' +
        '</div>';
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      modal.querySelector('#oai-done-close').addEventListener('click', function () {
        if (overlay.parentNode) document.body.removeChild(overlay);
        resolve();
      });

      // 'surprise' - roll a gif and show it (with its odds); the page's CSP allows
      // chrome-extension: images, so a direct URL renders fine. Hide the button after use.
      modal.querySelector('#oai-surprise').addEventListener('click', function () {
        var picked = rollGif();
        if (!picked) return;
        var body = modal.querySelector('.oai-completion-body');
        var btn  = modal.querySelector('#oai-surprise');
        if (btn) btn.style.display = 'none';
        body.innerHTML =
          '<img src="' + esc(picked.url) + '" class="oai-gif-img" alt="' + esc(picked.alt) + '">' +
          '<div class="oai-gif-chance">this gif had a <strong>' + picked.chance + '%</strong> chance of appearing!</div>';
      });
    });
  }

  // ── Loading modal ──────────────────────────────────────────────────────────

  // gifs.js (a separate content-script file) is the editable source for the emote list
  // via window.OAI_GIFS. This inline copy is ONLY used as a fallback if that global didn't
  // load, so the surprise button never dead-ends. Edit gifs.js to change the list.
  var OAI_GIFS_FALLBACK = [
    { url: 'https://cdn3.emoji.gg/emojis/366752-cat.gif',                 alt: 'cat' },
    { url: 'https://cdn3.emoji.gg/emojis/666930-catrun.gif',             alt: 'CatRun' },
    { url: 'https://cdn3.emoji.gg/emojis/257763-dancingcat.gif',         alt: 'DancingCat' },
    { url: 'https://cdn3.emoji.gg/emojis/656926-wiggletailcat.gif',      alt: 'wiggletailcat' },
    { url: 'https://cdn3.emoji.gg/emojis/79967-happy-shiba-tailwag.gif', alt: 'happy_shiba_tailwag' },
    { url: 'https://cdn3.emoji.gg/emojis/136245-sneakycat.gif',          alt: 'sneakycat', chance: 5 },
    { url: 'https://cdn3.emoji.gg/emojis/3516-scubbacat.gif',            alt: 'Scubbacat', chance: 1 },
    { url: 'https://cdn3.emoji.gg/emojis/623251-shocked.gif',            alt: 'shocked',   chance: 1 },
    { url: 'https://cdn3.emoji.gg/emojis/29323-doggorun.gif',            alt: 'Doggorun',  chance: 2 },
  ];

  // Roll one gif from window.OAI_GIFS (defined in gifs.js). Entries may pin a `chance`
  // (percentage); any entry without one splits the leftover evenly, then everything is
  // normalised to 100%. Returns { url, alt, chance } where chance is the effective %.
  function rollGif() {
    var list = ((window.OAI_GIFS && window.OAI_GIFS.length) ? window.OAI_GIFS : OAI_GIFS_FALLBACK).slice();
    if (!list.length) return null;
    var pinned = 0, unpinned = 0;
    list.forEach(function (g) {
      if (typeof g.chance === 'number') pinned += g.chance; else unpinned++;
    });
    var each = unpinned > 0 ? Math.max(0, (100 - pinned) / unpinned) : 0;
    var weights = list.map(function (g) { return typeof g.chance === 'number' ? g.chance : each; });
    var total = weights.reduce(function (a, w) { return a + w; }, 0) || 1;
    var roll = Math.random() * total, cum = 0, idx = 0;
    for (var i = 0; i < weights.length; i++) { cum += weights[i]; if (roll < cum) { idx = i; break; } }
    return { url: list[idx].url, alt: list[idx].alt || '', chance: Math.round(weights[idx] / total * 100) };
  }

  function showLoadingModal(message) {
    var overlay = document.createElement('div');
    overlay.className = 'oai-modal-overlay';
    var modal = document.createElement('div');
    modal.className = 'oai-modal oai-modal--loading';
    modal.innerHTML =
      '<span class="oai-spinner oai-spinner--lg"></span>' +
      '<span class="oai-loading-text">' + esc(message) + '</span>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    return {
      remove: function () { if (overlay.parentNode) document.body.removeChild(overlay); }
    };
  }

  // ── Confirmation modal (Phase 1: Preview Data) ─────────────────────────────

  function showConfirmation(entries, existingRows, allOptions, stats, crossMonth, sheetName, fileName) {
    return new Promise(function (resolve) {
      var matchMap = new Map();
      var seen = new Set();
      for (var e of entries) {
        var key = e.clientEngagement + '\x00' + e.task;
        if (!seen.has(key)) { seen.add(key); matchMap.set(key, e.matchedValue || null); }
      }

      var overlay = document.createElement('div');
      overlay.className = 'oai-modal-overlay';

      var modal = document.createElement('div');
      modal.className = 'oai-modal oai-modal--conf';

      var crossMonthHtml = '';
      if (crossMonth && crossMonth.isCross) {
        var dateRange = formatCrossMonthDates(crossMonth.from, crossMonth.to);
        crossMonthHtml =
          '<div class="oai-conf-cross-month-warning">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17.01"/></svg>' +
            ' This timesheet spans two months (' + esc(dateRange) + '). ' + (CROSS_MONTH_ENABLED ? 'The tool will fill both months.' : '<br>Only the current month will be filled, switch to the other month and run again') +
          '</div>';
      }

      var gridHtml = buildPhase1Grid(entries, allOptions, matchMap, Object.assign({}, stats, { _sheetName: sheetName, _fileName: fileName }));

      modal.innerHTML =
        '<div class="oai-conf-header">' +
          '<span class="oai-conf-title">Step 1: Review Data</span>' +
          '<button class="oai-modal-x" id="oai-p1-x" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="oai-conf-inner">' + gridHtml + '</div>' +
        '<div class="oai-conf-actions">' +
          crossMonthHtml +
          '<div class="oai-conf-buttons">' +
            '<button class="oai-btn oai-btn--secondary" id="oai-p1-refresh" title="Re-pull the Client : Engagement list from the page">↻ Refresh engagement</button>' +
            '<button class="oai-btn oai-btn--secondary" id="oai-p1-back"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg> Back</button>' +
            '<button class="oai-btn oai-btn--primary" id="oai-p1-ok">Step 2: Tasks <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-left:2px"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></button>' +
          '</div>' +
        '</div>';

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      attachPhase1Events(modal, matchMap, overlay);
      attachTooltips(modal);

      // Client names in grid order (client <select>s render one-per-key in this same order).
      var orderedClients = [];
      (function () {
        var seenc = new Set();
        entries.forEach(function (e) {
          var k = e.clientEngagement + '\x00' + e.task;
          if (!seenc.has(k)) { seenc.add(k); orderedClients.push(e.clientEngagement); }
        });
      })();

      // Re-pull the live Client:Engagement options from the page and rebuild each row's
      // dropdown. Keeps a still-valid prior pick; otherwise re-runs the client auto-match.
      function refreshEngagementOptions() {
        var live = enumerateCandidateRows().allOptions.filter(function (o) { return o.value !== '_FIND'; });
        if (live.length === 0) return 0;
        var sels = Array.from(modal.querySelectorAll('.oai-conf-sel--client'));
        sels.forEach(function (sel, i) {
          var prev = sel.value;
          var html = '<option value="">- leave blank for import -</option>';
          live.forEach(function (o) { html += '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>'; });
          sel.innerHTML = html;
          if (prev && Array.from(sel.options).some(function (o) { return o.value === prev; })) {
            sel.value = prev;
          } else {
            var ckey = normalise(orderedClients[i] || ''), best = null, bestScore = 0;
            live.forEach(function (o) { var sc = scoreMatch(ckey, normalise(o.label)); if (sc > bestScore) { bestScore = sc; best = o; } });
            sel.value = (best && bestScore >= 0.4) ? best.value : '';
          }
        });
        return sels.length;
      }

      modal.querySelector('#oai-p1-refresh').addEventListener('click', function () {
        var b = this, o = b.innerHTML;
        var n = refreshEngagementOptions();
        b.innerHTML = n > 0 ? '✓ Pulled ' + n : 'No options yet';
        setTimeout(function () { b.innerHTML = o; }, 1400);
      });

      function close(confirmed, goBack) {
        if (overlay.parentNode) document.body.removeChild(overlay);
        resolve({ confirmed: confirmed, goBack: !!goBack, matchMap: matchMap });
      }

      modal.querySelector('#oai-p1-ok').addEventListener('click', async function () {
        var btn = this;
        var origHTML = btn.innerHTML;
        // Edge case: a row left on "- leave blank for import -" defaults to the
        // "Connor Group : Open Code Pending" engagement (every user has it) instead of
        // being left blank, so its hours/notes still land on a valid row.
        var placeholderCE = (function () {
          var norm = function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); };
          var opts = (allOptions || []).filter(function (o) { return o.value !== '_FIND'; });
          var hit = opts.find(function (o) { return norm(o.label) === 'connor group open code pending'; }) ||
                    opts.find(function (o) { return norm(o.label).indexOf('open code pending') >= 0; });
          return hit ? hit.value : null;
        })();
        var ceArr = [];
        modal.querySelectorAll('.oai-conf-sel--client').forEach(function (sel) {
          var v = sel.value;
          if ((!v || v === ':') && placeholderCE) v = placeholderCE;
          ceArr.push(v);
        });
        // Unique CE+Task keys in grid order. buildPhase1Grid renders one client <select>
        // per unique key in this same order, so index i lines up with ceArr[i]. We map
        // purely in memory here - NEVER via a data-* attribute, because the '\x00' key
        // separator does not survive an HTML attribute round-trip (it becomes U+FFFD),
        // which previously made every row resolve to null (blank tasks + no fill).
        var orderedKeys = [];
        entries.forEach(function (e) { var k = e.clientEngagement + '\x00' + e.task; if (orderedKeys.indexOf(k) < 0) orderedKeys.push(k); });
        btn.disabled = true;
        btn.textContent = 'Setting up rows…';
        try {
          var rowNums = await exposeAndFillClientEngagement(ceArr);
          var keyToRow = new Map(), keyToCE = new Map();
          orderedKeys.forEach(function (k, idx) {
            if (rowNums[idx]) keyToRow.set(k, rowNums[idx]);
            if (ceArr[idx] && ceArr[idx] !== ':' && ceArr[idx] !== '') keyToCE.set(k, ceArr[idx]);
          });
          entries.forEach(function (e) {
            var k = e.clientEngagement + '\x00' + e.task;
            e.row = keyToRow.has(k) ? keyToRow.get(k) : null;
            var ce = keyToCE.has(k) ? keyToCE.get(k) : null;
            e.matchedValue = ce;
            e.matchedLabel = ce ? (((allOptions || []).find(function (o) { return o.value === ce; }) || {}).label || ce) : null;
          });
          close(true);
        } catch (err) {
          btn.disabled = false;
          btn.innerHTML = origHTML;
          setStatus(esc(err.message), 'error');
        }
      });
      modal.querySelector('#oai-p1-back').addEventListener('click',  function () { close(false, true); });
      modal.querySelector('#oai-p1-x').addEventListener('click',     function () { close(false); });
    });
  }

  // ── Task selection modal (Phase 2: Input Tasks) ────────────────────────────

  function showTaskSelection(entries, rowTaskOptions, crossMonth, meta) {
    return new Promise(function (resolve) {
      var taskMap = new Map(); // rowNum -> taskValue
      var rowTaskText = new Map(); // rowNum -> Excel task string (for auto-match)
      entries.forEach(function (e) {
        if (e.row && !rowTaskText.has(e.row)) rowTaskText.set(e.row, e.task);
      });

      var overlay = document.createElement('div');
      overlay.className = 'oai-modal-overlay';

      var modal = document.createElement('div');
      modal.className = 'oai-modal oai-modal--conf';

      var crossMonthHtml = '';
      if (crossMonth && crossMonth.isCross) {
        var dateRange = formatCrossMonthDates(crossMonth.from, crossMonth.to);
        crossMonthHtml =
          '<div class="oai-conf-cross-month-warning">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17.01"/></svg>' +
            ' This timesheet spans two months (' + esc(dateRange) + '). ' + (CROSS_MONTH_ENABLED ? 'The tool will fill both months.' : '<br>Only the current month will be filled, switch to the other month and run again') +
          '</div>';
      }

      var gridHtml = buildPhase2Grid(entries, rowTaskOptions, taskMap, meta);

      modal.innerHTML =
        '<div class="oai-conf-header">' +
          '<span class="oai-conf-title">Step 2: Input Tasks</span>' +
          '<button class="oai-modal-x" id="oai-p2-x" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="oai-conf-inner">' + gridHtml + '</div>' +
        '<div class="oai-conf-actions">' +
          crossMonthHtml +
          '<div class="oai-conf-buttons">' +
            '<button class="oai-btn oai-btn--secondary" id="oai-p2-refresh" title="Re-pull each row\'s Task list from the page">↻ Refresh tasks</button>' +
            '<button class="oai-btn oai-btn--secondary" id="oai-p2-restart">↺ Restart</button>' +
            '<button class="oai-btn oai-btn--primary" id="oai-p2-ok">Fill Timesheet</button>' +
          '</div>' +
        '</div>';

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      modal.querySelectorAll('.oai-conf-sel--task').forEach(function (sel) {
        var rowNum = parseInt(sel.dataset.row, 10);
        if (sel.value) taskMap.set(rowNum, sel.value);
        sel.addEventListener('change', function () { taskMap.set(rowNum, this.value || null); });
      });
      attachTooltips(modal);

      // Dynamically populate task selects that haven't loaded yet
      var _taskPollActive = true;
      (function pollTaskOptions() {
        if (!_taskPollActive) return;
        var pending = modal.querySelectorAll('.oai-conf-sel--task[data-loading]');
        if (pending.length === 0) return;
        pending.forEach(function (sel) {
          var rowNum = parseInt(sel.dataset.row, 10);
          if (!rowNum) return;
          var liveOpts = enumerateTaskOptions(rowNum);
          if (liveOpts.length > 0) {
            liveOpts.forEach(function (o) {
              var opt = document.createElement('option');
              opt.value = o.value;
              opt.text = o.label;
              sel.appendChild(opt);
            });
            sel.removeAttribute('data-loading');
            sel.closest('td').classList.remove('oai-conf-td--task-loading');
            if (!sel.value) {
              var _m = resolveTaskForRow(rowTaskText.get(rowNum), liveOpts);
              if (_m) { sel.value = _m; taskMap.set(rowNum, _m); }
            }
          }
        });
        setTimeout(pollTaskOptions, 500);
      })();

      function close(confirmed, goBack) {
        _taskPollActive = false;
        if (overlay.parentNode) document.body.removeChild(overlay);
        resolve({ confirmed: confirmed, goBack: !!goBack, taskMap: taskMap });
      }

      // Re-pull each row's Task <select> options straight from the live DOM. Use this if
      // OpenAir finished loading a row's tasks after this modal opened, or if a row came
      // up empty. enumerateTaskOptions(rowNum) reads ts_c2_r{rowNum}, so each row shows the
      // Tasks OpenAir loaded for THAT row's Client:Engagement.
      function refreshTaskOptions() {
        var repulled = 0;
        modal.querySelectorAll('.oai-conf-sel--task').forEach(function (sel) {
          var rowNum = parseInt(sel.dataset.row, 10);
          if (!rowNum) return;
          var liveOpts = enumerateTaskOptions(rowNum);
          var prev = sel.value;
          sel.innerHTML = '<option value="">- leave blank for import -</option>';
          liveOpts.forEach(function (o) {
            var opt = document.createElement('option');
            opt.value = o.value; opt.text = o.label;
            sel.appendChild(opt);
          });
          // Keep the user's prior pick if still valid; otherwise re-run auto-match.
          if (prev && Array.from(sel.options).some(function (o) { return o.value === prev; })) {
            sel.value = prev;
          } else {
            var m = resolveTaskForRow(rowTaskText.get(rowNum), liveOpts);
            sel.value = m || '';
          }
          taskMap.set(rowNum, sel.value || null);
          if (liveOpts.length > 0) {
            sel.removeAttribute('data-loading');
            var td = sel.closest('td'); if (td) td.classList.remove('oai-conf-td--task-loading');
            repulled++;
          }
        });
        return repulled;
      }

      modal.querySelector('#oai-p2-refresh').addEventListener('click', function () {
        var btn = this, orig = btn.innerHTML;
        var n = refreshTaskOptions();
        btn.innerHTML = n > 0 ? '✓ Pulled ' + n : 'No tasks yet';
        setTimeout(function () { btn.innerHTML = orig; }, 1400);
      });

      modal.querySelector('#oai-p2-ok').addEventListener('click', function () { close(true); });
      modal.querySelector('#oai-p2-restart').addEventListener('click', function () {
        if (overlay.parentNode) document.body.removeChild(overlay);
        clearBeforeUnload();
        window.location.reload();
      });
      modal.querySelector('#oai-p2-x').addEventListener('click', function () { close(false); });
    });
  }

  // ── Main file handler ──────────────────────────────────────────────────────

  async function handleFile(file) {
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setStatus('Only <strong>.xlsx</strong> files are supported.', 'error');
      return;
    }
    try {
      clearStatus();
      var buffer = await file.arrayBuffer();
      var wb     = XLSX.read(buffer, { type: 'array', cellDates: true });

      // Sheet picker loop - Back button in Phase 2 restarts here
      var sheetName, rawEntries, skippedCells, existingRows, allOptions, resolved, stats, crossMonth, p1;
      while (true) {
        sheetName = await showSheetPicker(wb.SheetNames);
        if (!sheetName) { clearStatus(); return; }

        setStatus('<span class="oai-spinner"></span> Parsing sheet&hellip;', 'info');
        try {
          var parsed   = parseSheet(wb, sheetName);
          rawEntries   = parsed.entries;
          skippedCells = parsed.skippedCells;
        } catch (err) { setStatus(esc(err.message), 'error'); return; }

        setStatus('<span class="oai-spinner"></span> Reading OpenAir grid&hellip;', 'info');
        var enumResult = enumerateCandidateRows();
        existingRows = enumResult.rows;
        allOptions   = enumResult.allOptions;

        if (existingRows.length === 0 && allOptions.length === 0) {
          setStatus('No timesheet grid found. Make sure you are on the weekly timesheet entry page.', 'error');
          return;
        }

        resolved   = resolveRows(rawEntries, existingRows, allOptions);
        var uniqueKeys = new Set(rawEntries.map(function (e) { return e.clientEngagement + '\x00' + e.task; }));
        stats = { entries: rawEntries.length, dataRows: uniqueKeys.size, skippedCells: skippedCells };
        clearStatus();

        crossMonth = detectCrossMonth();

        // ── Phase 1: Preview Data ──
        p1 = await showConfirmation(resolved, existingRows, allOptions, stats, crossMonth, sheetName, file.name);
        if (p1.goBack) continue; // Back button - re-show sheet picker
        if (!p1.confirmed) { clearStatus(); return; }
        break; // proceed to fill
      }

      // Row + Client:Engagement (matchedValue/Label) were assigned onto `resolved` during
      // Phase 1, in memory - no fragile data-attribute key round-trip. Just clone them.
      var finalEntries = resolved.map(function (e) { return Object.assign({}, e); });

      // Cache confirmed selections (keyed by client name only, matching resolveRows)
      var seenKeys = new Set();
      finalEntries.forEach(function (e) {
        var k = normalise(e.clientEngagement);
        if (e.matchedValue && !seenKeys.has(k)) { rowCache.set(k, e.matchedValue); seenKeys.add(k); }
      });

      // Wait briefly for OpenAir to populate task dropdowns for each row.
      var loadingModal = showLoadingModal('Loading task options…');
      setStatus('<span class="oai-spinner"></span> Loading task options…', 'info');
      var uniqueRowNums = Array.from(new Set(finalEntries.filter(function (e) { return e.row; }).map(function (e) { return e.row; })));
      await waitForTaskOptions(uniqueRowNums);

      // Collect whatever task options are available; Phase 2 polls for the rest.
      var rowTaskOptions = new Map();
      finalEntries.forEach(function (e) {
        if (e.row && !rowTaskOptions.has(e.row)) {
          rowTaskOptions.set(e.row, enumerateTaskOptions(e.row));
        }
      });

      loadingModal.remove();
      clearStatus();

      // ── Phase 2: Input Tasks (Back button loops to sheet picker) ──
      var p2 = await showTaskSelection(finalEntries, rowTaskOptions, crossMonth, { fileName: file.name, sheetName: sheetName, stats: stats });
      if (p2.goBack) {
        // User hit Back - restart from sheet picker; the while(true) loop above handles it.
        // We re-enter handleFile from the top to avoid deep re-entrant state.
        handleFile(file);
        return;
      }
      if (!p2.confirmed) { clearStatus(); return; }

      // ── Fill tasks + hours ──
      setStatus('<span class="oai-spinner"></span> Filling timesheet…', 'info');
      var fillResults;
      try { fillResults = await fillTasksAndHours(finalEntries, p2.taskMap); }
      catch (err) { setStatus('Fill failed: ' + esc(err.message), 'error'); return; }

      // ── Scenario 1: cross-month - navigate to next month and re-fill ──
      // TEMP: gated off via CROSS_MONTH_ENABLED while single-month is stabilised. The
      // banner still warns the user; only the auto-navigation is suppressed.
      if (CROSS_MONTH_ENABLED && crossMonth && crossMonth.isCross) {
        try {
          setStatus('<span class="oai-spinner"></span> Navigating to next month…', 'info');
          await clickNextMonthLink();
          await waitForTimesheetGrid();

          // Build ordered CE values + keys (same order as Phase 1 modal rows)
          var ceValuesOrdered = [], ceKeysOrdered = [];
          var _seenCeKeys = new Set();
          finalEntries.forEach(function (e) {
            var k = e.clientEngagement + '\x00' + e.task;
            if (!_seenCeKeys.has(k)) { _seenCeKeys.add(k); ceValuesOrdered.push(e.matchedValue || ':'); ceKeysOrdered.push(k); }
          });

          setStatus('<span class="oai-spinner"></span> Setting up rows for next month…', 'info');
          var rowNumsNext = await exposeAndFillClientEngagement(ceValuesOrdered);

          // Remap each entry's row (and the task map) to next month's REAL row numbers.
          var keyToRowNext = new Map();
          ceKeysOrdered.forEach(function (k, idx) { if (rowNumsNext[idx]) keyToRowNext.set(k, rowNumsNext[idx]); });
          var taskMapNext = new Map();
          finalEntries.forEach(function (e) {
            var k = e.clientEngagement + '\x00' + e.task;
            if (keyToRowNext.has(k)) {
              var oldRow = e.row, newRow = keyToRowNext.get(k);
              if (p2.taskMap.has(oldRow) && !taskMapNext.has(newRow)) taskMapNext.set(newRow, p2.taskMap.get(oldRow));
              e.row = newRow;
            }
          });
          await waitForTaskOptions(rowNumsNext.filter(Boolean));

          setStatus('<span class="oai-spinner"></span> Filling next month…', 'info');
          await fillTasksAndHours(finalEntries, taskMapNext);

        } catch (err) {
          setStatus('Cross-month fill error: ' + esc(err.message), 'warning');
          return;
        }
      }

      // ── Completion modal (shows an Audit Log only when entries failed) ──
      clearStatus();
      await showCompletionModal(fillResults);
    } catch (err) {
      setStatus(esc(err.message), 'error');
    }
  }

  // ── Panel ─────────────────────────────────────────────────────────────────

  function createPanel() {
    if (document.getElementById('oai-panel')) return;
    var panel = document.createElement('div');
    panel.id = 'oai-panel';

    panel.innerHTML =
      '<div class="oai-header">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
        '<span class="oai-title">Timesheet Importer</span>' +
      '</div>' +
      '<div class="oai-body">' +
        '<div class="oai-dropzone" id="oai-dz" tabindex="0" role="button" aria-label="Drop .xlsx or click to browse">' +
          '<div class="oai-dropzone-icon">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
          '</div>' +
          '<div class="oai-dropzone-text">Drop <strong>.xlsx</strong> here</div>' +
          '<div class="oai-dz-sub">or click to browse</div>' +
          '<div class="oai-dz-sub oai-dz-sub--cols">Mandatory columns: client : eng, task, [day] time, [day] notes</div>' +
          '<input type="file" id="oai-file-input" accept=".xlsx" style="display:none">' +
        '</div>' +
        '<button class="oai-btn--download" id="oai-dl-btn">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
          'Download template' +
        '</button>' +
        '<div class="oai-status" id="oai-status" aria-live="polite"></div>' +
      '</div>';

    document.body.appendChild(panel);
    panelStatus = panel.querySelector('#oai-status');

    var dz        = panel.querySelector('#oai-dz');
    var fileInput = panel.querySelector('#oai-file-input');

    dz.addEventListener('dragover', function (e) {
      e.preventDefault();
      dz.classList.add('oai-dz--active');
    });
    dz.addEventListener('dragleave', function () { dz.classList.remove('oai-dz--active'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      dz.classList.remove('oai-dz--active');
      var f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    dz.addEventListener('click', function () { fileInput.click(); });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    fileInput.addEventListener('change', function () {
      if (fileInput.files[0]) handleFile(fileInput.files[0]);
      fileInput.value = '';
    });

    panel.querySelector('#oai-dl-btn').addEventListener('click', function () {
      var a = document.createElement('a');
      a.href     = chrome.runtime.getURL('template.xlsx');
      a.download = 'Timesheet template v1.2.xlsx';
      a.click();
    });
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.action === 'ping') {
      sendResponse({ ok: true, isTimesheetPage: !!document.querySelector(GRID_SEL) });
      return false;
    }
    if (msg.action === 'getCandidateRows') {
      var r = enumerateCandidateRows();
      sendResponse({ rows: r.rows, allOptions: r.allOptions });
      return false;
    }
    if (msg.action === 'fillTimesheet') {
      fillTimesheet(msg.entries)
        .then(function (results) { sendResponse({ ok: true, results: results }); })
        .catch(function (err)    { sendResponse({ ok: false, error: err.message }); });
      return true;
    }
    if (msg.action === 'applyTheme') {
      applyContentTheme(msg.color, msg.mode);
      sendResponse({ ok: true });
      return false;
    }
  });

  function init() {
    if (document.querySelector(GRID_SEL)) { createPanel(); return; }
    var t = setInterval(function () {
      if (document.querySelector(GRID_SEL)) { clearInterval(t); createPanel(); }
    }, 500);
    setTimeout(function () { clearInterval(t); }, 15000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
