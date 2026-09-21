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
        type: 'page-update', side: 'jp', page: info.page, totalPages: info.total,
        url: window.location.href, title: document.title
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

// Android-only: native pinch-zoom-then-pan is unreliable on this WebView
// (zoomScale unreadable, panning breaks after a pinch — see
// docs/superpowers/notes/zoom-feasibility.md). This disables native zoom
// and implements pinch-to-zoom + pan entirely inside the page's own touch
// handling — not via a React Native overlay, which was found to swallow
// single-finger taps meant for the page's own tap/swipe navigation before
// they ever reach the WebView. Because this runs in the same context as
// the page's own listeners and only calls preventDefault() for gestures it
// actually handles (2+ fingers, or 1 finger while already zoomed in),
// normal single-finger page turning is untouched.
export const ANDROID_CUSTOM_ZOOM_SETUP_SCRIPT = `
(function () {
  var meta = document.querySelector('meta[name="viewport"]');
  if (meta) {
    meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
  }
  document.body.style.transformOrigin = '50% 50%';

  var MIN_SCALE = 1, MAX_SCALE = 3;
  var state = { scale: 1, x: 0, y: 0 };
  var base = null;
  var lastTouchCount = 0;

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function dist(a, b) { return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY); }
  function mid(a, b) { return { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 }; }

  function clampState() {
    state.scale = clamp(state.scale, MIN_SCALE, MAX_SCALE);
    var maxX = (window.innerWidth * (state.scale - 1)) / 2;
    var maxY = (window.innerHeight * (state.scale - 1)) / 2;
    state.x = clamp(state.x, -maxX, maxX);
    state.y = clamp(state.y, -maxY, maxY);
  }

  function applyTransform() {
    document.body.style.transform = 'translate(' + state.x + 'px, ' + state.y + 'px) scale(' + state.scale + ')';
  }

  function rebase(touches) {
    if (touches.length >= 2) {
      var m = mid(touches[0], touches[1]);
      base = { scale: state.scale, x: state.x, y: state.y, distance: dist(touches[0], touches[1]), midX: m.x, midY: m.y };
    } else if (touches.length === 1) {
      base = { scale: state.scale, x: state.x, y: state.y, panX: touches[0].pageX, panY: touches[0].pageY };
    } else {
      base = null;
    }
    lastTouchCount = touches.length;
  }

  document.addEventListener('touchstart', function (e) { rebase(e.touches); }, { passive: true });
  document.addEventListener('touchend', function (e) { rebase(e.touches); }, { passive: true });
  document.addEventListener('touchcancel', function (e) { rebase(e.touches); }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    var touches = e.touches;
    if (touches.length !== lastTouchCount || !base) rebase(touches);

    if (touches.length >= 2) {
      var newDist = dist(touches[0], touches[1]);
      var newMid = mid(touches[0], touches[1]);
      var ratio = base.distance > 0 ? newDist / base.distance : 1;
      state.scale = base.scale * ratio;
      state.x = base.x + (newMid.x - base.midX);
      state.y = base.y + (newMid.y - base.midY);
      clampState();
      applyTransform();
      e.preventDefault();
    } else if (touches.length === 1 && state.scale > 1.01) {
      state.x = base.x + (touches[0].pageX - base.panX);
      state.y = base.y + (touches[0].pageY - base.panY);
      clampState();
      applyTransform();
      e.preventDefault();
    }
    // else: single finger, not zoomed — leave untouched for the page's own
    // swipe/tap page-turn handling.
  }, { passive: false });
})();
true;
`;
