export const MANGAPLUS_INJECTED_SCRIPT = `
(function () {
  function parsePageInfo() {
    var el = document.querySelector('[class*="pageNumber"]');
    if (!el) return null;
    var match = (el.textContent || '').match(/(\\d+)\\s*\\/\\s*(\\d+)/);
    if (!match) return null;
    return { page: parseInt(match[1], 10), total: parseInt(match[2], 10) };
  }

  var lastPage = null;
  function checkPage() {
    var info = parsePageInfo();
    if (info && info.page !== lastPage) {
      lastPage = info.page;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'page-update', side: 'en', page: info.page, totalPages: info.total,
        url: window.location.href, title: document.title
      }));
    }
  }
  // ponytail: 300ms poll instead of a MutationObserver on the reader's internal
  // render cycle — simplest thing that works; if battery/perf ever matters,
  // switch to observing '.zao-surface' scroll events directly.
  setInterval(checkPage, 300);
  checkPage();

  document.addEventListener('message', handleHostMessage);
  window.addEventListener('message', handleHostMessage);

  function handleHostMessage(event) {
    var cmd;
    try { cmd = JSON.parse(event.data); } catch (e) { return; }
    if (!cmd || cmd.type !== 'navigate') return;

    var surface = document.querySelector('.zao-surface');
    var images = document.querySelectorAll('.zao-image');
    if (!surface || !images.length) return;

    var targetIndex = Math.max(0, Math.min(images.length - 1, cmd.targetPage - 1));
    var targetImg = images[targetIndex];
    if (targetImg) surface.scrollTop = targetImg.offsetTop;
  }
})();
true;
`;
