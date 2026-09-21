// Android-only: native pinch-zoom-then-pan is unreliable on WebView
// (zoomScale unreadable, panning breaks after a pinch — see
// docs/superpowers/notes/zoom-feasibility.md), and native zoom never goes
// below the page's initial fit-to-screen scale. Both variants below disable
// native zoom and implement pinch-to-zoom entirely inside the page's own
// touch handling — not via a React Native overlay, which was found to
// swallow single-finger taps meant for the page's own tap/swipe navigation
// before they ever reached the WebView.

function disableNativeZoom(): string {
  return `
  var meta = document.querySelector('meta[name="viewport"]');
  if (meta) {
    meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
  }
  `;
}

// For a single fit-to-screen page (Shonen Jump+): a uniform CSS transform on
// document.body, with pan while zoomed in. Because this only calls
// preventDefault() for gestures it actually handles (2+ fingers, or 1 finger
// while zoomed in), normal single-finger page-turn swipes are untouched.
export function androidTransformZoomScript(): string {
  return `
(function () {
  ${disableNativeZoom()}
  document.body.style.transformOrigin = '50% 50%';

  var MIN_SCALE = 0.5, MAX_SCALE = 3;
  var state = { scale: 1, x: 0, y: 0 };
  var base = null;
  var lastTouchCount = 0;

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function dist(a, b) { return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY); }
  function mid(a, b) { return { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 }; }

  function clampState() {
    state.scale = clamp(state.scale, MIN_SCALE, MAX_SCALE);
    var maxX = Math.max(0, (window.innerWidth * (state.scale - 1)) / 2);
    var maxY = Math.max(0, (window.innerHeight * (state.scale - 1)) / 2);
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
}

// For a continuous vertical image strip (MangaPlus): resizing document.body
// via a transform fights the scroll container's own fixed CSS height,
// leaving blank space instead of revealing more content (confirmed live —
// the container was found and resized, but content still didn't fill it).
// Simpler and actually correct for this structure: resize each page image's
// own width (height follows automatically, preserving aspect ratio — no
// distortion), letting the site's native vertical scroll do the rest
// unmodified. Only 2+ finger touches are ever intercepted; panning is
// always the page's own native single-finger scroll.
export function androidImageWidthZoomScript(imageSelector: string): string {
  return `
(function () {
  ${disableNativeZoom()}

  var MIN_SCALE = 0.5, MAX_SCALE = 3;
  var scale = 1;
  var base = null;

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function dist(a, b) { return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY); }

  function applyScale() {
    var images = document.querySelectorAll(${JSON.stringify(imageSelector)});
    for (var i = 0; i < images.length; i++) {
      images[i].style.width = (scale * 100) + '%';
      images[i].style.display = 'block';
      images[i].style.marginLeft = 'auto';
      images[i].style.marginRight = 'auto';
    }
  }

  document.addEventListener('touchstart', function (e) {
    if (e.touches.length >= 2) {
      base = { scale: scale, distance: dist(e.touches[0], e.touches[1]) };
    }
  }, { passive: true });

  document.addEventListener('touchend', function (e) {
    if (e.touches.length < 2) base = null;
  }, { passive: true });
  document.addEventListener('touchcancel', function (e) {
    if (e.touches.length < 2) base = null;
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (e.touches.length < 2) return; // single finger — native scroll handles it untouched
    if (!base) base = { scale: scale, distance: dist(e.touches[0], e.touches[1]) };
    var newDist = dist(e.touches[0], e.touches[1]);
    var ratio = base.distance > 0 ? newDist / base.distance : 1;
    scale = clamp(base.scale * ratio, MIN_SCALE, MAX_SCALE);
    applyScale();
    e.preventDefault();
  }, { passive: false });
})();
true;
`;
}
