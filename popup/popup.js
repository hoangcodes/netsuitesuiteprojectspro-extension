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
        var email = 'q.hoang@connorgp.com';
        var done = function (ok) {
          if (span) { span.textContent = ok ? 'Email copied!' : 'Copy failed'; setTimeout(function () { span.textContent = orig; }, 1500); }
        };
        // Fallback copy (works without the clipboardWrite permission, on a user gesture).
        var fallback = function () {
          try {
            var ta = document.createElement('textarea');
            ta.value = email; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.focus(); ta.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(ta); done(ok);
          } catch (e) { done(false); }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(email).then(function () { done(true); }).catch(fallback);
        } else { fallback(); }
      });
    }

    // Appearance widget
    OAIAppearance.init(document.getElementById('oai-appearance-widget'));
  }

  document.addEventListener('DOMContentLoaded', init);
})();
