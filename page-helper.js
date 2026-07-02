// Runs in the PAGE's MAIN world (see manifest content_scripts entry with "world": "MAIN").
//
// The main content script (content.js) runs in Chrome's ISOLATED world, which has its
// own `window`. Setting `window.onbeforeunload = null` there does NOT clear the page's
// handler, so OpenAir's native "Leave site? Changes you made may not be saved." prompt
// still fires when the extension intentionally reloads (Restart) or navigates
// (Save / cross-month). This tiny main-world script listens on the SHARED document for
// the 'oai-clear-beforeunload' event dispatched by content.js and nulls the page's
// handler in the world where it actually lives.
(function () {
  document.addEventListener('oai-clear-beforeunload', function () {
    try { window.onbeforeunload = null; } catch (e) {}
  });
})();
