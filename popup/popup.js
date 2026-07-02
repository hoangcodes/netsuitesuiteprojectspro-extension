// popup.js - OpenAir Timesheet Importer popup

(function () {
  'use strict';

  const OPENAIR_HOST = 'connor-group.app.netsuitesuiteprojectspro.com';
  let activeTabId = null;

  // Status indicator
  function setStatus(cls, label) {
    document.getElementById('statusDot').className    = 'status-dot status-dot--' + cls;
    document.getElementById('statusLabel').textContent = label;
  }

  // Send a message to the active tab's content script
  function sendToTab(msg) {
    return new Promise((resolve, reject) => {
      if (!activeTabId) { reject(new Error('No active tab')); return; }
      chrome.tabs.sendMessage(activeTabId, msg, resp => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message)); return;
        }
        resolve(resp);
      });
    });
  }

  // Init
  async function init() {
    chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
      const tab = tabs?.[0];
      if (!tab) { setStatus('error', 'No tab found'); return; }
      activeTabId = tab.id;

      if (!tab.url || !tab.url.includes(OPENAIR_HOST)) {
        setStatus('warn', 'openair undetected');
        return;
      }

      try {
        const pong = await sendToTab({ action: 'ping' });
        if (pong?.isTimesheetPage) setStatus('ok',   'openair detected');
        else                       setStatus('warn', 'openair undetected');
      } catch {
        setStatus('warn', 'openair undetected');
      }
    });

    document.getElementById('downloadBtn').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href     = chrome.runtime.getURL('template.xlsx');
      a.download = 'Timesheet template v1.2.xlsx';
      a.click();
    });

    document.getElementById('downloadExampleBtn').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href     = chrome.runtime.getURL('example.xlsx');
      a.download = '7.2026 Example.xlsx';
      a.click();
    });

    // Email the developer -> copy address to clipboard
    var copyBtn = document.getElementById('copyEmailBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var span = copyBtn.querySelector('span');
        var orig = span ? span.textContent : '';
        var restore = function () { if (span) setTimeout(function () { span.textContent = orig; }, 1500); };
        navigator.clipboard.writeText('q.hoang@connorgp.com').then(function () {
          if (span) span.textContent = 'Email copied!';
          restore();
        }).catch(function () {
          if (span) span.textContent = 'Copy failed';
          restore();
        });
      });
    }

    // Preferences: "don't show surprise button" toggle (persisted to chrome.storage.sync;
    // the content script reads oai_hide_surprise and omits the button on the completion modal)
    var surprisePref = document.getElementById('oai-surprise-pref');
    if (surprisePref) {
      // "surprise" ON = show the button; default ON. Stored as oai_hide_surprise (the inverse),
      // which the content script reads to hide the button when the user turns this off.
      chrome.storage.sync.get(['oai_hide_surprise'], function (prefs) {
        surprisePref.checked = !prefs.oai_hide_surprise; // unset -> ON by default
      });
      surprisePref.addEventListener('change', function () {
        chrome.storage.sync.set({ oai_hide_surprise: !surprisePref.checked });
      });
    }

    // Appearance widget
    OAIAppearance.init(document.getElementById('oai-appearance-widget'));
  }

  document.addEventListener('DOMContentLoaded', init);
})();
