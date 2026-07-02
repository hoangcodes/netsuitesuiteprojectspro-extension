/**
 * parsing.test.js - OpenAir Timesheet Importer unit tests
 *
 * Usage: paste this entire file into Chrome DevTools console while on any page
 *        that has content.js injected (the OpenAir timesheet page), OR run via:
 *        node tests/parsing.test.js
 *
 * Zero-dependency test runner - no Jest, no Mocha.
 */

(function () {
  'use strict';

  // ── Minimal test runner ────────────────────────────────────────────────────
  var passed = 0, failed = 0;
  var failures = [];

  function assert(condition, label) {
    if (condition) {
      passed++;
    } else {
      failed++;
      failures.push('FAIL: ' + label);
      console.error('FAIL:', label);
    }
  }

  function assertEqual(actual, expected, label) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) console.error('  actual:', actual, ' expected:', expected);
    assert(ok, label);
  }

  function assertThrows(fn, msgFragment, label) {
    try {
      fn();
      assert(false, label + ' (should have thrown)');
    } catch (e) {
      assert(
        !msgFragment || String(e.message).toLowerCase().indexOf(msgFragment.toLowerCase()) !== -1,
        label + ' (error includes "' + msgFragment + '")'
      );
    }
  }

  // ── Shared utilities (mirror content.js exactly) ───────────────────────────
  var DAY_NAMES  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DOW_TO_COL = [3, 4, 5, 6, 7, 8, 9];
  var COL_TO_DOW = { 3:0, 4:1, 5:2, 6:3, 7:4, 8:5, 9:6 };
  var DAY_PATS   = [
    {re:/^sun/i, dow:0}, {re:/^mon/i, dow:1}, {re:/^tue/i, dow:2},
    {re:/^wed/i, dow:3}, {re:/^thu/i, dow:4}, {re:/^fri/i, dow:5}, {re:/^sat/i, dow:6},
  ];

  function normalise(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function dice(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    var m = new Map();
    for (var i = 0; i < a.length - 1; i++) {
      var k = a.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1);
    }
    var h = 0;
    for (var j = 0; j < b.length - 1; j++) {
      var k2 = b.slice(j, j + 2); var n = m.get(k2) || 0;
      if (n > 0) { h++; m.set(k2, n - 1); }
    }
    return (2 * h) / (a.length + b.length - 2);
  }

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

  // ── Workbook stub (avoids needing SheetJS in tests) ───────────────────────
  function makeWb(sheetName, rows, a1Value) {
    var cells = {};
    if (a1Value !== undefined) {
      cells['A1'] = { v: a1Value };
    } else if (rows.length > 0 && rows[0].length > 0 && rows[0][0] != null) {
      cells['A1'] = { v: rows[0][0] };
    }
    return {
      SheetNames: [sheetName],
      Sheets: { [sheetName]: Object.assign(cells, { _rows: rows }) }
    };
  }

  // Local parseSheet that uses _rows instead of XLSX.utils.sheet_to_json
  function runParseSheet(wb, sheetName) {
    var ws = wb.Sheets[sheetName];
    if (!ws) throw new Error('Sheet "' + sheetName + '" not found.');
    var a1 = ws['A1'];
    if (!a1 || !/client/i.test(String(a1.v || '')))
      throw new Error('Cell A1 must say "Client : Engagement". Is this the right sheet?');
    var rows = ws._rows;
    if (!rows || rows.length < 2) throw new Error('Sheet appears empty.');
    var header = rows[0];
    var dayCols = [];
    for (var i = 0; i < header.length; i++) {
      var dow = detectDow(header[i]);
      if (dow >= 0) dayCols.push({ idx: i, col: DOW_TO_COL[dow], day: DAY_NAMES[dow], notesIdx: i + 1 });
    }
    if (dayCols.length === 0)
      [2,4,6,8,10,12,14].forEach(function(pos, d) {
        dayCols.push({ idx: pos, col: DOW_TO_COL[d], day: DAY_NAMES[d], notesIdx: pos + 1 });
      });
    var entries = [], skippedCells = 0;
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r]; if (!row) continue;
      var client = String(row[0] || '').trim();
      var task   = String(row[1] || '').trim();
      if (!client && !task) continue;
      if (/^total/i.test(client)) continue;
      for (var d = 0; d < dayCols.length; d++) {
        var dc  = dayCols[d];
        var raw = row[dc.idx];
        if (raw === null || raw === undefined || raw === '') { skippedCells++; continue; }
        var hours = parseFloat(raw);
        if (isNaN(hours) || hours <= 0) { skippedCells++; continue; }
        var notes = String(row[dc.notesIdx] || '').trim();
        entries.push({ clientEngagement: client, task: task, hours: hours, notes: notes,
                       col: dc.col, dayName: dc.day, row: null });
      }
    }
    if (entries.length === 0) throw new Error('No time entries found. Check that hours are filled in.');
    return { entries: entries, skippedCells: skippedCells };
  }

  // Local resolveRows (mirrors content.js exactly)
  function runResolveRows(rawEntries, existingRows, allOptions, sessionCache) {
    var cache     = sessionCache || new Map();
    var passCache = new Map();
    return rawEntries.map(function(entry) {
      var key = normalise(entry.clientEngagement + ' ' + entry.task);
      if (cache.has(key)) {
        var cv = cache.get(key);
        var er = existingRows.find(function(r) { return r.value === cv; });
        return Object.assign({}, entry, { matchedValue: cv, matchedLabel: er ? er.label : cv, row: er ? er.rowNum : null });
      }
      if (passCache.has(key)) {
        var cv2 = passCache.get(key);
        var er2 = existingRows.find(function(r) { return r.value === cv2; });
        return Object.assign({}, entry, { matchedValue: cv2, matchedLabel: er2 ? er2.label : cv2, row: er2 ? er2.rowNum : null });
      }
      var bestOpt = null, bestScore = 0;
      for (var o = 0; o < allOptions.length; o++) {
        var s = dice(key, normalise(allOptions[o].label));
        if (s > bestScore) { bestScore = s; bestOpt = allOptions[o]; }
      }
      var optVal   = (bestOpt && bestScore >= 0.3) ? bestOpt.value : null;
      var optLabel = (bestOpt && bestScore >= 0.3) ? bestOpt.label : null;
      passCache.set(key, optVal);
      var er3 = optVal ? existingRows.find(function(r) { return r.value === optVal; }) : null;
      return Object.assign({}, entry, { matchedValue: optVal, matchedLabel: optLabel, row: er3 ? er3.rowNum : null });
    });
  }

  // Parameterised detectCrossMonth (mirrors content.js but accepts a seed date)
  function detectCrossMonthFrom(today) {
    var sunday   = new Date(today); sunday.setDate(today.getDate() - today.getDay());
    var saturday = new Date(sunday); saturday.setDate(sunday.getDate() + 6);
    if (sunday.getMonth() !== saturday.getMonth()) return { isCross: true, from: sunday, to: saturday };
    return { isCross: false };
  }

  // Standard header row used across parseSheet tests
  var HDR = [
    'Client : Engagement', 'Task',
    'Sunday', 'Sunday notes', 'Monday', 'Monday notes',
    'Tuesday', 'Tuesday notes', 'Wednesday', 'Wednesday notes',
    'Thursday', 'Thursday notes', 'Friday', 'Friday notes',
    'Saturday', 'Saturday notes',
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 1: detectDow
  // ─────────────────────────────────────────────────────────────────────────
  console.group('1. detectDow');
  assertEqual(detectDow('Sunday'),   0, 'Sunday string -> 0');
  assertEqual(detectDow('Monday'),   1, 'Monday string -> 1');
  assertEqual(detectDow('Saturday'), 6, 'Saturday string -> 6');
  assertEqual(detectDow('sun'),      0, 'lowercase sun -> 0');
  assertEqual(detectDow('Mon'),      1, 'Mon abbreviation -> 1');
  assertEqual(detectDow('THURSDAY'), 4, 'THURSDAY uppercase -> 4');
  assertEqual(detectDow('random'),  -1, 'unrecognised string -> -1');
  assertEqual(detectDow(null),      -1, 'null -> -1');
  // Excel serial 45473 = 2024-06-30 (Sunday)
  assertEqual(detectDow(45473),      0, 'Excel serial for a Sunday -> 0');
  // Excel serial 45474 = 2024-07-01 (Monday)
  assertEqual(detectDow(45474),      1, 'Excel serial for a Monday -> 1');
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 2: normalise
  // ─────────────────────────────────────────────────────────────────────────
  console.group('2. normalise');
  assertEqual(normalise('Cerebras : NS Admin'), 'cerebras ns admin', 'strips colons/punctuation');
  assertEqual(normalise('  HELLO  WORLD  '),    'hello world',       'trims and squashes spaces');
  assertEqual(normalise(null),                  '',                  'null -> empty string');
  assertEqual(normalise(42),                    '42',                'number coerced to string');
  assertEqual(normalise(''),                    '',                  'empty string -> empty string');
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 3: dice coefficient
  // ─────────────────────────────────────────────────────────────────────────
  console.group('3. dice');
  assertEqual(dice('abc', 'abc'), 1, 'identical strings -> 1');
  assertEqual(dice('', 'abc'),    0, 'empty first arg -> 0');
  assertEqual(dice('abc', ''),    0, 'empty second arg -> 0');
  assertEqual(dice('a', 'abc'),   0, 'first arg < 2 chars -> 0');
  assertEqual(dice('abc', 'a'),   0, 'second arg < 2 chars -> 0');
  assert(dice('cerebras ns admin', 'cerebras ns admin') === 1, 'long identical -> 1');
  assert(dice('cerebras ptp', 'cerebras ptp work') > 0.5,     'similar strings > 0.5');
  assert(dice('apple', 'zzzzzz') < 0.2,                       'dissimilar strings < 0.2');
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 4: parseSheet -- happy path
  // ─────────────────────────────────────────────────────────────────────────
  console.group('4. parseSheet - happy path');
  (function () {
    var wb = makeWb('Sheet1', [
      HDR,
      ['Acme Corp', 'Dev', 2, 'Fixed bug', 3, '', null, null, null, null, null, null, null, null, null, null],
      ['Globex',    'QA',  null, null, 4, 'PR review', null, null, null, null, null, null, null, null, null, null],
    ]);
    var res = runParseSheet(wb, 'Sheet1');
    assertEqual(res.entries.length, 3, '3 entries total');
    assertEqual(res.entries[0].clientEngagement, 'Acme Corp', 'first entry client');
    assertEqual(res.entries[0].task,    'Dev',      'first entry task');
    assertEqual(res.entries[0].hours,   2,          'first entry hours = 2');
    assertEqual(res.entries[0].notes,   'Fixed bug','first entry notes');
    assertEqual(res.entries[0].col,     3,          'Sunday -> col 3');
    assertEqual(res.entries[0].dayName, 'Sun',      'Sunday dayName');
    assertEqual(res.entries[1].col,     4,          'Monday -> col 4');
    assertEqual(res.entries[1].notes,   '',         'empty notes cell -> empty string');
    assertEqual(res.entries[2].clientEngagement, 'Globex', 'second row client');
    assertEqual(res.entries[2].col,     4,          'Globex Monday -> col 4');
    assertEqual(res.entries[2].notes,   'PR review','Globex notes');
    assert(res.skippedCells >= 6, 'at least 6 empty day cells skipped');
  })();
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 5: parseSheet -- Total Time row filtered
  // ─────────────────────────────────────────────────────────────────────────
  console.group('5. parseSheet - Total Time row filtered');
  (function () {
    var wb = makeWb('Sheet1', [
      HDR,
      ['Acme Corp', 'Dev', 8, '', 8, '', null, null, null, null, null, null, null, null, null, null],
      ['Total Time', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      ['TOTAL hours', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    ]);
    var res = runParseSheet(wb, 'Sheet1');
    assert(res.entries.every(function(e) { return e.clientEngagement !== 'Total Time'; }), 'Total Time excluded');
    assert(res.entries.every(function(e) { return e.clientEngagement !== 'TOTAL hours'; }), 'TOTAL hours excluded');
    assertEqual(res.entries.length, 2, 'only real data rows parsed');
  })();
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 6: parseSheet -- error cases
  // ─────────────────────────────────────────────────────────────────────────
  console.group('6. parseSheet - error cases');
  // Empty sheet: no A1 cell, so A1 guard fires before row-count guard
  assertThrows(
    function() { runParseSheet(makeWb('S', []), 'S'); },
    'client', 'empty rows array -> A1 guard fires first'
  );
  assertThrows(
    function() { runParseSheet(makeWb('S', [['Wrong header'], ['a','b', 1]], 'Wrong header'), 'S'); },
    'client', 'bad A1 value throws mentioning client'
  );
  assertThrows(
    function() { runParseSheet(makeWb('S', [HDR]), 'S'); },
    'empty', 'header-only sheet throws'
  );
  assertThrows(
    function() {
      runParseSheet(makeWb('S', [
        HDR,
        ['Acme', 'Dev', null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      ]), 'S');
    },
    'no time entries', 'all-null hours throws'
  );
  assertThrows(
    function() {
      runParseSheet(makeWb('S', [
        HDR,
        ['Acme', 'Dev', -1, '', null, null, null, null, null, null, null, null, null, null, null, null],
      ]), 'S');
    },
    'no time entries', 'negative hours excluded, throws'
  );
  assertThrows(
    function() {
      runParseSheet(makeWb('S', [
        HDR,
        ['Acme', 'Dev', 0, '', null, null, null, null, null, null, null, null, null, null, null, null],
      ]), 'S');
    },
    'no time entries', 'zero hours excluded, throws'
  );
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 7: parseSheet -- blank rows skipped
  // ─────────────────────────────────────────────────────────────────────────
  console.group('7. parseSheet - blank rows skipped');
  (function () {
    var wb = makeWb('S', [
      HDR,
      ['Acme', 'Dev', 4, '', null, null, null, null, null, null, null, null, null, null, null, null],
      ['', '', 8, '', null, null, null, null, null, null, null, null, null, null, null, null],
      [null, null, 8, '', null, null, null, null, null, null, null, null, null, null, null, null],
    ]);
    var res = runParseSheet(wb, 'S');
    assertEqual(res.entries.length, 1, 'blank/null client+task rows skipped');
    assertEqual(res.entries[0].clientEngagement, 'Acme', 'only real row parsed');
  })();
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 8: parseSheet -- case-insensitive / abbreviated day headers
  // ─────────────────────────────────────────────────────────────────────────
  console.group('8. parseSheet - flexible day detection');
  (function () {
    var altHdr = ['Client : Engagement', 'Task', 'sun', 'sun notes', 'MON', 'MON NOTES',
                   'Tuesday', 'Tue notes', 'wednesday', 'wed notes',
                   'Thu', 'thu notes', 'fri', 'fri notes', 'SAT', 'sat notes'];
    var wb = makeWb('S', [
      altHdr,
      ['Acme', 'Dev', 2, 'note', null, null, null, null, null, null, null, null, null, null, null, null],
    ]);
    var res = runParseSheet(wb, 'S');
    assertEqual(res.entries.length, 1, 'abbreviated/mixed-case headers parsed');
    assertEqual(res.entries[0].col, 3, 'sun -> col 3');
  })();
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 9: resolveRows -- high-confidence match
  // ─────────────────────────────────────────────────────────────────────────
  console.group('9. resolveRows - high-confidence match');
  (function () {
    var existingRows = [
      { rowNum: 5, value: '100:200', label: 'Cerebras : NS Admin' },
      { rowNum: 6, value: '100:300', label: 'Cerebras : PTP' },
    ];
    var allOptions = existingRows.map(function(r) { return { value: r.value, label: r.label }; });
    var raw = [
      { clientEngagement: 'Cerebras', task: 'NS Admin', hours: 2, notes: '', col: 3, dayName: 'Sun', row: null },
    ];
    var resolved = runResolveRows(raw, existingRows, allOptions);
    assertEqual(resolved[0].matchedValue, '100:200', 'correct optionValue matched');
    assertEqual(resolved[0].row,          5,         'rowNum resolved from existingRows');
    assertEqual(resolved[0].matchedLabel, 'Cerebras : NS Admin', 'label preserved');
  })();
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 10: resolveRows -- low confidence -> null
  // ─────────────────────────────────────────────────────────────────────────
  console.group('10. resolveRows - low confidence');
  (function () {
    var existingRows = [{ rowNum: 1, value: 'x:y', label: 'Totally Different Company : Zzz' }];
    var allOptions   = [{ value: 'x:y', label: 'Totally Different Company : Zzz' }];
    var raw = [
      { clientEngagement: 'Cerebras', task: 'NS Admin', hours: 2, notes: '', col: 3, dayName: 'Sun', row: null },
    ];
    var resolved = runResolveRows(raw, existingRows, allOptions);
    assert(resolved[0].matchedValue === null, 'low-confidence match -> null matchedValue');
    assertEqual(resolved[0].row, null, 'row is null when unmatched');
  })();
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 11: resolveRows -- session cache hit
  // ─────────────────────────────────────────────────────────────────────────
  console.group('11. resolveRows - session cache hit');
  (function () {
    var existingRows = [{ rowNum: 7, value: 'cached:val', label: 'Cached Client : Eng' }];
    var allOptions   = [{ value: 'cached:val', label: 'Cached Client : Eng' }];
    var cache = new Map([['cerebras ns admin', 'cached:val']]);
    var raw = [
      { clientEngagement: 'Cerebras', task: 'NS Admin', hours: 3, notes: '', col: 4, dayName: 'Mon', row: null },
    ];
    var resolved = runResolveRows(raw, existingRows, allOptions, cache);
    assertEqual(resolved[0].matchedValue, 'cached:val', 'cache hit: returns cached value');
    assertEqual(resolved[0].row,          7,            'cache hit: resolves rowNum from existingRows');
  })();
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 12: resolveRows -- passCache deduplicates within one call
  // ─────────────────────────────────────────────────────────────────────────
  console.group('12. resolveRows - passCache dedup');
  (function () {
    var existingRows = [{ rowNum: 9, value: 'a:b', label: 'Acme Corp Dev' }];
    var allOptions   = [{ value: 'a:b', label: 'Acme Corp Dev' }];
    var raw = [
      { clientEngagement: 'Acme Corp', task: 'Dev', hours: 4, notes: '', col: 3, dayName: 'Sun', row: null },
      { clientEngagement: 'Acme Corp', task: 'Dev', hours: 3, notes: '', col: 4, dayName: 'Mon', row: null },
    ];
    var resolved = runResolveRows(raw, existingRows, allOptions);
    assertEqual(resolved[0].matchedValue, resolved[1].matchedValue, 'same key -> same matchedValue');
    assertEqual(resolved[0].row,          resolved[1].row,          'same key -> same rowNum');
  })();
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 13: detectCrossMonth
  // ─────────────────────────────────────────────────────────────────────────
  console.group('13. detectCrossMonth');
  (function () {
    // June 30, 2026 (Tuesday) -> Sun Jun 28 - Sat Jul 4 -> cross-month
    var juneThirty = new Date(2026, 5, 30);
    var r1 = detectCrossMonthFrom(juneThirty);
    assert(r1.isCross === true,  'Jun 30 2026: week spans Jun/Jul -> isCross true');
    assertEqual(r1.from.getMonth(), 5, 'from month = June (5)');
    assertEqual(r1.to.getMonth(),   6, 'to month = July (6)');

    // June 15, 2026 (Monday) -> Sun Jun 14 - Sat Jun 20 -> no cross
    var juneFifteenth = new Date(2026, 5, 15);
    var r2 = detectCrossMonthFrom(juneFifteenth);
    assert(r2.isCross === false, 'Jun 15 2026: week stays in June -> isCross false');

    // June 1, 2026 (Monday) -> Sun May 31 - Sat Jun 6 -> cross
    var juneFirst = new Date(2026, 5, 1);
    var r3 = detectCrossMonthFrom(juneFirst);
    assert(r3.isCross === true,  'Jun 1 2026: week spans May/Jun -> isCross true');
    assertEqual(r3.from.getMonth(), 4, 'from month = May (4)');

    // July 5, 2026 (Sunday): week Jul 5-11 -> no cross
    var julySunday = new Date(2026, 6, 5);
    var r4 = detectCrossMonthFrom(julySunday);
    assert(r4.isCross === false, 'Jul 5 2026 (Sunday): week Jul 5-11 -> no cross');
  })();
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 14: DOW_TO_COL / COL_TO_DOW round-trip
  // ─────────────────────────────────────────────────────────────────────────
  console.group('14. DOW_TO_COL / COL_TO_DOW round-trip');
  for (var dow = 0; dow < 7; dow++) {
    var col = DOW_TO_COL[dow];
    assertEqual(COL_TO_DOW[col], dow, 'DOW ' + dow + ' -> col ' + col + ' -> DOW ' + dow);
  }
  console.groupEnd();

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n---- Test results ----');
  console.log('Passed: ' + passed);
  console.log('Failed: ' + failed);
  if (failures.length) {
    console.error('\nFailures:');
    failures.forEach(function(f) { console.error('  ' + f); });
  } else {
    console.log('All tests passed');
  }
})();
