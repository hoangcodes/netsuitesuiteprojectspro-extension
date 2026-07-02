// popup/features/appearance/appearance.js
// Manages color theme (accent) + mode (light / classic-dark / dark) for the popup.
// Settings are persisted in chrome.storage.sync so they survive browser restarts.

var OAIAppearance = (function () {
  'use strict';

  var DEFAULT_COLOR = 'slate';
  var DEFAULT_MODE  = 'light';

  var COLOR_OPTIONS = [
    { value: 'slate',  label: 'Netsuite Slate (default)', hex: '#44536B', dark: '#303d50' },
    { value: 'nam',    label: 'Nam Blue',                 hex: '#0166B1', dark: '#014E86' },
    { value: 'sias',   label: 'Sias Violet',              hex: '#833AB4', dark: '#6B2E93' },
    { value: 'wilson', label: 'Wilson Orange',            hex: '#F77737', dark: '#DD5E1E' },
    { value: 'coe',    label: 'COE Green',                hex: '#075E54', dark: '#054A42' },
  ];

  var MODE_OPTIONS = [
    { value: 'light',        label: 'Light', sub: 'default' },
    { value: 'classic-dark', label: 'Dark',  sub: null      },
    { value: 'dark',         label: 'Cool',  sub: null      },
  ];

  // ── Apply to popup ──────────────────────────────────────────────────────────

  function applyColorToPopup(color) {
    var opt = COLOR_OPTIONS.filter(function (c) { return c.value === color; })[0] || COLOR_OPTIONS[0];
    document.documentElement.style.setProperty('--accent',      opt.hex);
    document.documentElement.style.setProperty('--accent-dark', opt.dark);
  }

  function applyModeToPopup(mode) {
    MODE_OPTIONS.forEach(function (m) {
      document.body.classList.remove('oai-mode-' + m.value);
    });
    document.body.classList.add('oai-mode-' + (mode || DEFAULT_MODE));
  }

  // ── Notify content script ───────────────────────────────────────────────────

  function notifyContentScript(color, mode) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'applyTheme',
        color:  color,
        mode:   mode,
      }, function () {
        // Ignore "no receiver" errors — content script may not be on an OpenAir page
        void chrome.runtime.lastError;
      });
    });
  }

  // ── Persist + apply ─────────────────────────────────────────────────────────

  function saveAndApply(color, mode, containerEl) {
    chrome.storage.sync.set({ oai_theme_color: color, oai_theme_mode: mode });
    applyColorToPopup(color);
    applyModeToPopup(mode);
    notifyContentScript(color, mode);
  }

  // ── Render widget ───────────────────────────────────────────────────────────

  function render(containerEl, currentColor, currentMode) {
    containerEl.innerHTML = [
      '<div class="oai-appear-row">',
        '<span class="oai-appear-field-label">Color theme</span>',
        '<select class="oai-appear-select" id="oai-color-select">',
          COLOR_OPTIONS.map(function (c) {
            return '<option value="' + c.value + '"' +
              (c.value === currentColor ? ' selected' : '') +
              '>' + c.label + '</option>';
          }).join(''),
        '</select>',
      '</div>',
      '<div class="oai-appear-row oai-appear-row--modes">',
        '<span class="oai-appear-field-label">Theme</span>',
        '<div class="oai-appear-modes">',
          MODE_OPTIONS.map(function (m) {
            var active = m.value === currentMode;
            return [
              '<button class="oai-appear-mode-btn' + (active ? ' is-active' : '') + '"',
              ' data-mode="' + m.value + '">',
              '<span class="oai-mode-radio"><span class="oai-mode-dot"></span></span>',
              '<span class="oai-mode-label">',
                m.label,
                m.sub ? '<span class="oai-mode-sub"> (' + m.sub + ')</span>' : '',
              '</span>',
              '</button>',
            ].join('');
          }).join(''),
        '</div>',
      '</div>',
    ].join('');

    // Color select change
    containerEl.querySelector('#oai-color-select').addEventListener('change', function (e) {
      var activeBtn = containerEl.querySelector('.oai-appear-mode-btn.is-active');
      var mode = activeBtn ? activeBtn.dataset.mode : currentMode;
      saveAndApply(e.target.value, mode, containerEl);
    });

    // Mode radio clicks
    containerEl.querySelectorAll('.oai-appear-mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        containerEl.querySelectorAll('.oai-appear-mode-btn').forEach(function (b) {
          b.classList.remove('is-active');
        });
        btn.classList.add('is-active');
        var colorSel = containerEl.querySelector('#oai-color-select');
        saveAndApply(colorSel ? colorSel.value : currentColor, btn.dataset.mode, containerEl);
      });
    });
  }

  // ── Public init ─────────────────────────────────────────────────────────────

  function init(containerEl) {
    if (!containerEl) return;
    chrome.storage.sync.get(['oai_theme_color', 'oai_theme_mode'], function (prefs) {
      var color = prefs.oai_theme_color || DEFAULT_COLOR;
      var mode  = prefs.oai_theme_mode  || DEFAULT_MODE;
      applyColorToPopup(color);
      applyModeToPopup(mode);
      render(containerEl, color, mode);
    });
  }

  return { init: init };
})();
