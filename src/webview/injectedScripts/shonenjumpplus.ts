export const SHONENJUMPPLUS_INJECTED_SCRIPT = `
(function () {
  function getIsRtl(content) {
    return content.getAttribute('dir') !== 'ltr';
  }

  // Primary: the site's own position slider, when present — a value it
  // maintains itself, so nothing to compute or get the sign wrong on.
  function getPageInfoFromSlider() {
    var slider = document.querySelector('.js-slider');
    var content = document.querySelector('.js-viewer-content');
    if (!slider || !content) return null;
    var page = parseInt(slider.value, 10);
    var total = parseInt(slider.max, 10);
    if (isNaN(page) || isNaN(total)) return null;
    return { page: page, total: total, isRtl: getIsRtl(content), via: 'slider' };
  }

  // Fallback: derive position from the horizontal layout offset directly,
  // for pages/titles where the slider is missing or reports something
  // unusable. 'right' becomes more negative as you move forward through the
  // story (verified live), so step count is -right / stepWidth, not right /
  // stepWidth.
  function getPageInfoFromLayout() {
    var content = document.querySelector('.js-viewer-content');
    var areas = document.querySelectorAll('.js-page-area');
    if (!content || !areas.length) return null;
    var right = parseFloat(content.style.right || '0');
    var stepWidth = areas.length > 1
      ? Math.abs(areas[0].getBoundingClientRect().left - areas[1].getBoundingClientRect().left)
      : areas[0].getBoundingClientRect().width;
    if (!stepWidth) return null;
    var isSpread = content.className.indexOf('is-spread') !== -1;
    var stepsPerNav = isSpread ? 2 : 1;
    var currentStep = Math.round(-right / stepWidth);
    return {
      page: currentStep + 1, total: areas.length, isRtl: getIsRtl(content),
      via: 'layout', stepWidth: stepWidth, stepsPerNav: stepsPerNav,
    };
  }

  function getPageInfo() {
    var fromSlider = getPageInfoFromSlider();
    if (fromSlider && fromSlider.page >= 1 && fromSlider.page <= fromSlider.total) return fromSlider;
    return getPageInfoFromLayout();
  }

  var lastPage = null;
  function checkPage() {
    var info = getPageInfo();
    if (info && info.page !== lastPage) {
      lastPage = info.page;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'page-update', side: 'jp', page: info.page, totalPages: info.total
      }));
    }
  }
  // ponytail: 300ms poll instead of hooking the site's own render cycle —
  // simplest thing that works; revisit if it proves too slow/heavy.
  setInterval(checkPage, 300);
  checkPage();

  function dispatchArrow(key) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: key, bubbles: true, cancelable: true }));
  }

  function setSliderValue(slider, value) {
    var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(slider, String(value));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }

  document.addEventListener('message', handleHostMessage);
  window.addEventListener('message', handleHostMessage);

  function handleHostMessage(event) {
    var cmd;
    try { cmd = JSON.parse(event.data); } catch (e) { return; }
    if (!cmd || cmd.type !== 'navigate') return;

    var start = getPageInfo();
    if (!start) return;
    var target = Math.max(1, Math.min(start.total, cmd.targetPage));
    var goingForward = target > start.page;
    var stepsLeft = Math.abs(target - start.page);
    if (stepsLeft === 0) return;

    var forwardKey = start.isRtl ? 'ArrowLeft' : 'ArrowRight';
    var backwardKey = start.isRtl ? 'ArrowRight' : 'ArrowLeft';
    var key = goingForward ? forwardKey : backwardKey;

    // Steps one page at a time toward the absolute target, since the
    // confirmed-reliable mechanism (a single simulated key press) only ever
    // moves one page. A large delta just takes proportionally longer.
    function stepOnce() {
      if (stepsLeft <= 0) return;
      var beforeStep = getPageInfo();
      dispatchArrow(key);
      stepsLeft -= 1;
      setTimeout(function () {
        var afterStep = getPageInfo();
        // ponytail: synthetic KeyboardEvents may be ignored if the site
        // checks event.isTrusted. Ceiling: these per-step fallbacks (slider,
        // then raw layout offset) are brittle to markup changes. Upgrade
        // path: find and call the site's real navigation handler once
        // identified.
        if (beforeStep && afterStep && afterStep.page === beforeStep.page) {
          var delta = goingForward ? 1 : -1;
          if (beforeStep.via === 'slider') {
            var slider = document.querySelector('.js-slider');
            if (slider) setSliderValue(slider, beforeStep.page + delta);
          } else if (beforeStep.via === 'layout') {
            var content = document.querySelector('.js-viewer-content');
            var offset = delta * beforeStep.stepWidth * beforeStep.stepsPerNav;
            content.style.right = (parseFloat(content.style.right || '0') + offset) + 'px';
          }
        }
        stepOnce();
      }, 200);
    }
    stepOnce();
  }
})();
true;
`;
