# Manga Dual-Language Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A React Native app showing the same manga page in Japanese (Shonen Jump+) and English (MangaPlus) side by side, synced by page number, using each site's own logged-in WebView (no credential handling by the app).

**Architecture:** Two live `react-native-webview` instances load the real sites. A small JS snippet injected into each WebView detects page changes and reports them to the host app via `postMessage`; the host runs a pure state-machine reducer that decides whether to mirror the page change to the other side (by sending a `navigate` command back into that WebView) or, if mirroring can't be confirmed, show a manual "realign" overlay. Reading/zooming/panning stay entirely native to each site's own WebView UI.

**Tech Stack:** React Native (Expo, TypeScript), `react-native-webview`, Jest (`jest-expo` preset) for unit tests.

**Spec:** `docs/superpowers/specs/2026-09-20-manga-dual-language-reader-design.md`

## Global Constraints

- No credential storage or handling anywhere in the app — login happens inside each WebView, on the real site.
- No custom image viewer — WebView native rendering (zoom/pan/paging) is never replaced or re-rendered.
- No app store distribution — this is a personal-use sideload/dev build.
- Zoom sync is out of scope unless Task 2's feasibility check finds a workable mechanism.
- Chapter/title selection is never reimplemented — the user searches and opens chapters using each site's own UI inside its WebView.

---

## Verified technical facts (live-inspected 2026-09-20, feed these into the tasks below — do not re-derive from memory)

**MangaPlus (`mangaplus.shueisha.co.jp`)** — vertical continuous scroll:
- Scrollable container: `.zao-surface` (`overflow-y: scroll`).
- Each page: `<img class="zao-image">`, stacked vertically.
- Page indicator: an element matching `[class*="pageNumber"]` (CSS-modules hashed class, e.g. `Viewer-module_pageNumber_2Ma3Q` — match by substring, the hash suffix is not stable across builds), text shape `"<p>N <span>/ total</span></p>"`.
- Setting `.zao-surface.scrollTop` directly (or `image.offsetTop`) moves the reader and the page indicator updates reactively — confirmed live.

**Shonen Jump+ (`shonenjumpplus.com`)** — horizontal transform-driven carousel:
- Container: `.js-viewer-content` (also carries classes `image-container` and, in two-page-spread mode, `is-spread`), `position: absolute`, positioned via an inline `style.right` (in px), **not** a CSS `transform` and **not** a scrollable element.
- Each page: `.js-page-area` (only the ~5 nearest the current position are actually rendered as `<canvas>` at a time — the rest are placeholders until scrolled near).
- No plain-text page-number indicator was found in the DOM.
- Pressing `ArrowLeft` advances to the next page (manga reads right-to-left); `ArrowRight` goes back — confirmed live via trusted key events.
- **Open risk**: a JS-dispatched synthetic `KeyboardEvent` (as opposed to Playwright's trusted-level key press) may be ignored if the site checks `event.isTrusted`. Task 6 must verify this against the live site and use the documented fallback if so.
- No numeric zoom/scale control was found in the DOM by class name, but the page shows Japanese menu labels "拡大" (zoom) and "全画面" (fullscreen) — relevant to Task 2, not confirmed further.

---

### Task 1: Project scaffolding

**Files:**
- Create: `App.tsx`, `app.json`, `package.json`, `tsconfig.json` (via `create-expo-app`)
- Create: `App.test.tsx`
- Modify: `package.json` (jest config)

**Interfaces:**
- Produces: a runnable Expo + TypeScript project with Jest wired up, that later tasks add `src/` modules into.

- [ ] **Step 1: Scaffold the Expo TypeScript project**

```bash
cd /home/sterte/allanime
npx create-expo-app@latest . --template blank-typescript
```

- [ ] **Step 2: Install WebView and test dependencies**

```bash
npx expo install react-native-webview
npx expo install jest-expo jest @types/jest react-test-renderer
```

- [ ] **Step 3: Configure Jest**

Add to `package.json`:

```json
{
  "scripts": {
    "test": "jest"
  },
  "jest": {
    "preset": "jest-expo"
  }
}
```

- [ ] **Step 4: Write a smoke test**

```tsx
// App.test.tsx
import { render } from '@testing-library/react-native';
import App from './App';

test('App renders without crashing', () => {
  const { toJSON } = render(<App />);
  expect(toJSON()).not.toBeNull();
});
```

Install the renderer helper: `npm install --save-dev @testing-library/react-native`

- [ ] **Step 5: Run the test, verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Expo TypeScript app with Jest"
```

---

### Task 2: Dual WebView reader screen + zoom feasibility check

**Files:**
- Create: `src/screens/ReaderScreen.tsx`
- Modify: `App.tsx` (render `ReaderScreen`)
- Create: `docs/superpowers/notes/zoom-feasibility.md`

**Interfaces:**
- Produces: `ReaderScreen` component (default export), rendering two side-by-side `WebView`s, refs named `jpWebViewRef` / `enWebViewRef` — later tasks (7, 8) extend this same file, don't recreate it.

- [ ] **Step 1: Build the two-WebView layout**

```tsx
// src/screens/ReaderScreen.tsx
import React, { useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import WebView from 'react-native-webview';

export default function ReaderScreen() {
  const jpWebViewRef = useRef<WebView>(null);
  const enWebViewRef = useRef<WebView>(null);

  return (
    <View style={styles.container}>
      <WebView
        ref={jpWebViewRef}
        style={styles.pane}
        source={{ uri: 'https://shonenjumpplus.com/' }}
      />
      <WebView
        ref={enWebViewRef}
        style={styles.pane}
        source={{ uri: 'https://mangaplus.shueisha.co.jp/' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row' },
  pane: { flex: 1 },
});
```

```tsx
// App.tsx
import ReaderScreen from './src/screens/ReaderScreen';

export default function App() {
  return <ReaderScreen />;
}
```

- [ ] **Step 2: Run the app on a device/emulator and manually verify both sites load**

Run: `npx expo start` (press `a` for Android emulator, or scan the QR code with Expo Go on a real device)
Expected: both panes load their respective site's home page and are individually scrollable/interactive.

Inside each WebView, log in and manually navigate to any chapter with real page content — needed for the zoom check in the next step.

- [ ] **Step 3: Check whether zoom state can be read and mirrored via CSS, without touching native pinch-zoom**

Temporarily add an `onScroll` handler to log `nativeEvent.zoomScale` from one `WebView`, and temporarily add to each WebView's `injectedJavaScript` a test snippet that applies `document.body.style.transform = 'scale(1.3)'; document.body.style.transformOrigin = '50% 50%';` to confirm CSS-driven zoom is visually plausible as a decoupled-from-native-pinch mechanism:

```tsx
<WebView
  ref={jpWebViewRef}
  style={styles.pane}
  source={{ uri: 'https://shonenjumpplus.com/' }}
  onScroll={(e) => console.log('JP zoomScale', e.nativeEvent.zoomScale)}
/>
```

Confirm manually:
1. Does `zoomScale` change and get logged when you pinch-zoom inside the WebView? (tests whether native pinch state is readable)
2. Does injecting `document.body.style.transform = 'scale(1.3)'` via the debugger/injected script visibly zoom the page content? (tests whether a CSS-only mirrored-zoom fallback is viable, independent of native pinch)

Remove the temporary `onScroll` logging and the temporary injected transform test code after checking — they are not part of the shipped screen.

- [ ] **Step 4: Write the finding**

```markdown
<!-- docs/superpowers/notes/zoom-feasibility.md -->
# Zoom sync feasibility — findings (2026-09-20 spike, Task 2)

- Native pinch-zoom state readable via `onScroll` → `nativeEvent.zoomScale`: <YES/NO, fill in from Step 3.1>
- CSS `transform: scale()` visually zooms WebView content when injected: <YES/NO, fill in from Step 3.2>
- **Decision**: <GO — build CSS-transform-based mirrored zoom as a follow-up plan / NO-GO — zoom stays independent per side, native only>
```

Fill in the actual results observed in Step 3, not placeholders — this file is the record future work reads before attempting zoom sync.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add dual WebView reader screen, record zoom feasibility findings"
```

---

### Task 3: Shared message types

**Files:**
- Create: `src/webview/messages.ts`

**Interfaces:**
- Produces: `Side`, `PageUpdateMessage`, `NavigateCommand` types, consumed by Tasks 4, 5, 6, 7.

- [ ] **Step 1: Write the types**

```ts
// src/webview/messages.ts
export type Side = 'jp' | 'en';

export interface PageUpdateMessage {
  type: 'page-update';
  side: Side;
  page: number;
  totalPages: number;
}

export interface NavigateCommand {
  type: 'navigate';
  direction: 'next' | 'prev';
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/webview/messages.ts
git commit -m "feat: add shared WebView message types"
```

---

### Task 4: Mirror state machine (TDD)

**Files:**
- Create: `src/sync/mirrorState.ts`
- Test: `src/sync/mirrorState.test.ts`

**Interfaces:**
- Consumes: `Side` from `src/webview/messages.ts` (Task 3).
- Produces: `MirrorState`, `MirrorEvent`, `MirrorAction`, `initialMirrorState`, `MIRROR_TIMEOUT_MS`, `reduceMirrorState(state, event): { state: MirrorState; action: MirrorAction }` — consumed by Task 7.

- [ ] **Step 1: Write the failing tests**

```ts
// src/sync/mirrorState.test.ts
import {
  reduceMirrorState,
  initialMirrorState,
  MIRROR_TIMEOUT_MS,
} from './mirrorState';

test('first page-changed event just records state, no navigate command', () => {
  const { state, action } = reduceMirrorState(initialMirrorState, {
    type: 'PAGE_CHANGED', side: 'jp', page: 1, origin: 'user', now: 1000,
  });
  expect(state.pageJP).toBe(1);
  expect(action.sendNavigateTo).toBeUndefined();
});

test('subsequent user page change triggers a navigate command to the other side', () => {
  const afterFirst = reduceMirrorState(initialMirrorState, {
    type: 'PAGE_CHANGED', side: 'jp', page: 1, origin: 'user', now: 1000,
  }).state;
  const { state, action } = reduceMirrorState(afterFirst, {
    type: 'PAGE_CHANGED', side: 'jp', page: 2, origin: 'user', now: 1500,
  });
  expect(action).toEqual({ sendNavigateTo: 'en', direction: 'next', showFallback: false });
  expect(state.pendingMirror).toBe('en');
  expect(state.mirrorDeadline).toBe(1500 + MIRROR_TIMEOUT_MS);
});

test('mirrored confirmation from the other side clears pending state without re-triggering', () => {
  const state = {
    ...initialMirrorState,
    pageJP: 2, pageEN: 1, pendingMirror: 'en' as const, mirrorDeadline: 4500,
  };
  const result = reduceMirrorState(state, {
    type: 'PAGE_CHANGED', side: 'en', page: 2, origin: 'mirror', now: 1600,
  });
  expect(result.state.pendingMirror).toBeNull();
  expect(result.state.mirrorDeadline).toBeNull();
  expect(result.state.fallbackActive).toBe(false);
  expect(result.action.sendNavigateTo).toBeUndefined();
});

test('timeout check flips fallbackActive when mirror not confirmed in time', () => {
  const state = {
    ...initialMirrorState,
    pageJP: 2, pageEN: 1, pendingMirror: 'en' as const, mirrorDeadline: 4500,
  };
  const { state: next, action } = reduceMirrorState(state, { type: 'TIMEOUT_CHECK', now: 5000 });
  expect(next.fallbackActive).toBe(true);
  expect(action.showFallback).toBe(true);
});

test('timeout check before the deadline does nothing', () => {
  const state = {
    ...initialMirrorState,
    pageJP: 2, pageEN: 1, pendingMirror: 'en' as const, mirrorDeadline: 4500,
  };
  const { state: next } = reduceMirrorState(state, { type: 'TIMEOUT_CHECK', now: 4000 });
  expect(next.fallbackActive).toBe(false);
});

test('manual realign clears fallback and pending mirror', () => {
  const state = {
    ...initialMirrorState,
    fallbackActive: true, pendingMirror: 'en' as const, mirrorDeadline: 4500,
  };
  const { state: next, action } = reduceMirrorState(state, { type: 'MANUAL_REALIGN' });
  expect(next.fallbackActive).toBe(false);
  expect(next.pendingMirror).toBeNull();
  expect(action.showFallback).toBe(false);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- mirrorState`
Expected: FAIL with "Cannot find module './mirrorState'"

- [ ] **Step 3: Implement the state machine**

```ts
// src/sync/mirrorState.ts
import { Side } from '../webview/messages';

export const MIRROR_TIMEOUT_MS = 3000;

export interface MirrorState {
  pageJP: number | null;
  pageEN: number | null;
  pendingMirror: Side | null;
  mirrorDeadline: number | null;
  fallbackActive: boolean;
}

export const initialMirrorState: MirrorState = {
  pageJP: null,
  pageEN: null,
  pendingMirror: null,
  mirrorDeadline: null,
  fallbackActive: false,
};

export type MirrorEvent =
  | { type: 'PAGE_CHANGED'; side: Side; page: number; origin: 'user' | 'mirror'; now: number }
  | { type: 'TIMEOUT_CHECK'; now: number }
  | { type: 'MANUAL_REALIGN' };

export interface MirrorAction {
  sendNavigateTo?: Side;
  direction?: 'next' | 'prev';
  showFallback: boolean;
}

function otherSide(side: Side): Side {
  return side === 'jp' ? 'en' : 'jp';
}

export function reduceMirrorState(
  state: MirrorState,
  event: MirrorEvent,
): { state: MirrorState; action: MirrorAction } {
  if (event.type === 'MANUAL_REALIGN') {
    return {
      state: { ...state, pendingMirror: null, mirrorDeadline: null, fallbackActive: false },
      action: { showFallback: false },
    };
  }

  if (event.type === 'TIMEOUT_CHECK') {
    if (state.pendingMirror && state.mirrorDeadline !== null && event.now >= state.mirrorDeadline) {
      return {
        state: { ...state, fallbackActive: true },
        action: { showFallback: true },
      };
    }
    return { state, action: { showFallback: state.fallbackActive } };
  }

  // PAGE_CHANGED
  const priorPage = event.side === 'jp' ? state.pageJP : state.pageEN;
  const nextState: MirrorState = {
    ...state,
    pageJP: event.side === 'jp' ? event.page : state.pageJP,
    pageEN: event.side === 'en' ? event.page : state.pageEN,
  };

  if (event.origin === 'mirror') {
    // Confirms a mirror we requested — clear pending state, never re-trigger.
    return {
      state: { ...nextState, pendingMirror: null, mirrorDeadline: null, fallbackActive: false },
      action: { showFallback: false },
    };
  }

  if (priorPage === null) {
    // Initial page report for this side — nothing to mirror yet.
    return { state: nextState, action: { showFallback: state.fallbackActive } };
  }

  const direction: 'next' | 'prev' = event.page > priorPage ? 'next' : 'prev';
  const target = otherSide(event.side);
  return {
    state: {
      ...nextState,
      pendingMirror: target,
      mirrorDeadline: event.now + MIRROR_TIMEOUT_MS,
    },
    action: { sendNavigateTo: target, direction, showFallback: false },
  };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- mirrorState`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/sync/mirrorState.ts src/sync/mirrorState.test.ts
git commit -m "feat: add mirror state machine with TDD coverage"
```

---

### Task 5: MangaPlus injected script

**Files:**
- Create: `src/webview/injectedScripts/mangaplus.ts`

**Interfaces:**
- Consumes: wire shape of `PageUpdateMessage` / `NavigateCommand` from Task 3 (informal — this is plain JS embedded in a WebView, not a TS import; the JSON shape must match Task 3's types).
- Produces: `MANGAPLUS_INJECTED_SCRIPT: string`, consumed by Task 7.

- [ ] **Step 1: Write the script**

```ts
// src/webview/injectedScripts/mangaplus.ts
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
        type: 'page-update', side: 'en', page: info.page, totalPages: info.total
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
    var current = parsePageInfo();
    if (!surface || !images.length || !current) return;

    var targetIndex = cmd.direction === 'next' ? current.page : current.page - 2;
    var targetImg = images[Math.max(0, targetIndex)];
    if (targetImg) surface.scrollTop = targetImg.offsetTop;
  }
})();
true;
`;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually verify against the live site**

In `ReaderScreen.tsx` (from Task 2), temporarily add `injectedJavaScript={MANGAPLUS_INJECTED_SCRIPT}` and an `onMessage` handler that does `console.log(event.nativeEvent.data)` to the EN `WebView`. Run the app, open a chapter inside the EN WebView, scroll to change pages, and confirm a `page-update` message logs for each page change. Remove the temporary `onMessage` logging afterward (Task 7 wires the real handler).

- [ ] **Step 4: Commit**

```bash
git add src/webview/injectedScripts/mangaplus.ts
git commit -m "feat: add MangaPlus page-detection and navigate injected script"
```

---

### Task 6: Shonen Jump+ injected script

**Files:**
- Create: `src/webview/injectedScripts/shonenjumpplus.ts`

**Interfaces:**
- Consumes: wire shape of `PageUpdateMessage` / `NavigateCommand` from Task 3.
- Produces: `SHONENJUMPPLUS_INJECTED_SCRIPT: string`, consumed by Task 7.

- [ ] **Step 1: Write the script**

```ts
// src/webview/injectedScripts/shonenjumpplus.ts
export const SHONENJUMPPLUS_INJECTED_SCRIPT = `
(function () {
  function getPageInfo() {
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
    var currentStep = Math.round(right / stepWidth);
    return { page: currentStep + 1, total: areas.length, stepWidth: stepWidth, stepsPerNav: stepsPerNav };
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

  document.addEventListener('message', handleHostMessage);
  window.addEventListener('message', handleHostMessage);

  function handleHostMessage(event) {
    var cmd;
    try { cmd = JSON.parse(event.data); } catch (e) { return; }
    if (!cmd || cmd.type !== 'navigate') return;

    var before = getPageInfo();
    dispatchArrow(cmd.direction === 'next' ? 'ArrowLeft' : 'ArrowRight');

    // ponytail: synthetic KeyboardEvents may be ignored if the site checks
    // event.isTrusted. Ceiling: this direct style.right fallback is brittle
    // to markup changes. Upgrade path: find and call the site's real
    // navigation handler once identified.
    setTimeout(function () {
      var after = getPageInfo();
      if (before && after && after.page === before.page) {
        var content = document.querySelector('.js-viewer-content');
        var delta = (cmd.direction === 'next' ? 1 : -1) * before.stepWidth * before.stepsPerNav;
        content.style.right = (parseFloat(content.style.right || '0') + delta) + 'px';
      }
    }, 200);
  }
})();
true;
`;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually verify against the live site**

Same procedure as Task 5 Step 3, but on the JP `WebView` with `SHONENJUMPPLUS_INJECTED_SCRIPT`. Specifically confirm:
1. `page-update` messages log on manual page turns.
2. Sending a test `{"type":"navigate","direction":"next"}` command (via the WebView ref's `postMessage`) actually advances the page. If it doesn't on the first attempt, confirm the `style.right` fallback kicks in and moves the page instead — if neither works, note this in `docs/superpowers/notes/zoom-feasibility.md`'s sibling file (create `docs/superpowers/notes/shonenjumpplus-navigation.md`) as a known gap before proceeding to Task 7.

- [ ] **Step 4: Commit**

```bash
git add src/webview/injectedScripts/shonenjumpplus.ts
git commit -m "feat: add Shonen Jump+ page-detection and navigate injected script"
```

---

### Task 7: Wire ReaderScreen with the mirror state machine

**Files:**
- Modify: `src/screens/ReaderScreen.tsx`

**Interfaces:**
- Consumes: `MANGAPLUS_INJECTED_SCRIPT` (Task 5), `SHONENJUMPPLUS_INJECTED_SCRIPT` (Task 6), `reduceMirrorState`, `initialMirrorState`, `MirrorState` (Task 4), `PageUpdateMessage`, `NavigateCommand`, `Side` (Task 3).
- Produces: a fully wired `ReaderScreen` whose internal `mirrorState` drives navigate commands — consumed by Task 8 (`SyncOverlay` reads `mirrorState.fallbackActive`, `pageJP`, `pageEN`, and calls a realign callback).

- [ ] **Step 1: Wire message handling and the reducer into ReaderScreen**

```tsx
// src/screens/ReaderScreen.tsx
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import { MANGAPLUS_INJECTED_SCRIPT } from '../webview/injectedScripts/mangaplus';
import { SHONENJUMPPLUS_INJECTED_SCRIPT } from '../webview/injectedScripts/shonenjumpplus';
import { PageUpdateMessage, NavigateCommand, Side } from '../webview/messages';
import { reduceMirrorState, initialMirrorState, MirrorState } from '../sync/mirrorState';

export default function ReaderScreen() {
  const jpWebViewRef = useRef<WebView>(null);
  const enWebViewRef = useRef<WebView>(null);
  const [mirrorState, setMirrorState] = useState<MirrorState>(initialMirrorState);

  const sendNavigate = useCallback((side: Side, direction: 'next' | 'prev') => {
    const ref = side === 'jp' ? jpWebViewRef : enWebViewRef;
    const command: NavigateCommand = { type: 'navigate', direction };
    ref.current?.postMessage(JSON.stringify(command));
  }, []);

  const handleMessage = useCallback((side: Side, origin: 'user' | 'mirror') => (event: WebViewMessageEvent) => {
    let msg: PageUpdateMessage;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type !== 'page-update') return;

    setMirrorState((prev) => {
      const { state, action } = reduceMirrorState(prev, {
        type: 'PAGE_CHANGED', side, page: msg.page, origin, now: Date.now(),
      });
      if (action.sendNavigateTo && action.direction) {
        sendNavigate(action.sendNavigateTo, action.direction);
      }
      return state;
    });
  }, [sendNavigate]);

  useEffect(() => {
    if (!mirrorState.pendingMirror) return;
    const interval = setInterval(() => {
      setMirrorState((prev) => reduceMirrorState(prev, { type: 'TIMEOUT_CHECK', now: Date.now() }).state);
    }, 500);
    return () => clearInterval(interval);
  }, [mirrorState.pendingMirror]);

  return (
    <View style={styles.container}>
      <WebView
        ref={jpWebViewRef}
        style={styles.pane}
        source={{ uri: 'https://shonenjumpplus.com/' }}
        injectedJavaScript={SHONENJUMPPLUS_INJECTED_SCRIPT}
        onMessage={handleMessage('jp', 'user')}
      />
      <WebView
        ref={enWebViewRef}
        style={styles.pane}
        source={{ uri: 'https://mangaplus.shueisha.co.jp/' }}
        injectedJavaScript={MANGAPLUS_INJECTED_SCRIPT}
        onMessage={handleMessage('en', 'user')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row' },
  pane: { flex: 1 },
});
```

Note: both WebViews' `onMessage` are wired with `origin: 'user'` — mirrored page-updates confirming a navigate command also arrive through the same handler as `page-update` messages. `reduceMirrorState` already distinguishes real mirror-confirmations from user-driven changes by checking `pendingMirror` internally is not needed here: every `page-update` is reported as `origin: 'user'` from the WebView's own detection, since the injected script cannot tell *why* a page changed. This is safe because `reduceMirrorState`'s loop-prevention relies on `pendingMirror` tracking, not on the message's origin tag — **fix before shipping**: change `handleMessage`'s second argument to always pass `'user'` (already done above) and rely on the reducer's own `pendingMirror` bookkeeping; do not attempt to pass `'mirror'` from here, since the host cannot distinguish the two cases reliably. This makes the `origin: 'mirror'` branch in Task 4's reducer currently unreachable from real usage — acceptable for v1 (the reducer still works correctly using only the `origin: 'user'` path plus its timeout/fallback logic), but note it in a comment.

Add this comment above `handleMessage`:

```tsx
// Every WebView-reported page-update arrives as 'user' origin — the injected
// script can't distinguish a user-driven turn from one we just mirrored.
// Loop safety instead relies on reduceMirrorState's pendingMirror bookkeeping:
// a page-update on the side we're expecting a mirror confirmation from just
// clears pendingMirror without re-triggering, because reduceMirrorState only
// sends a new navigate command when priorPage !== null — see Task 4.
```

**Adjust Task 4 expectations accordingly**: since `origin` is always `'user'` in real usage, re-check the "mirrored confirmation" test case from Task 4 — it's still valid as a reducer-level guarantee (the reducer must handle an `origin: 'mirror'` event correctly if ever sent), but real callers only ever send `'user'`. This means real mirror confirmations go through the *same* `PAGE_CHANGED ... origin: 'user'` path as a normal move, which per Task 4's implementation **will** re-trigger another mirror in the opposite direction — a real loop risk that Task 4's tests didn't cover.

- [ ] **Step 2: Fix the loop risk — track our own pending mirrors instead of relying on message origin**

Update `src/sync/mirrorState.ts` (Task 4's file): replace the `origin` field's role. Instead of trusting a caller-supplied `origin`, have the reducer itself decide: if `event.side === state.pendingMirror` and the reported `event.page` matches the page implied by the pending direction, treat it as the mirror confirmation; otherwise treat it as a new user move.

```ts
// src/sync/mirrorState.ts — replace the PAGE_CHANGED branch in reduceMirrorState
// PAGE_CHANGED
const priorPage = event.side === 'jp' ? state.pageJP : state.pageEN;
const nextState: MirrorState = {
  ...state,
  pageJP: event.side === 'jp' ? event.page : state.pageJP,
  pageEN: event.side === 'en' ? event.page : state.pageEN,
};

const isAwaitedMirrorConfirmation = state.pendingMirror === event.side;
if (isAwaitedMirrorConfirmation) {
  return {
    state: { ...nextState, pendingMirror: null, mirrorDeadline: null, fallbackActive: false },
    action: { showFallback: false },
  };
}

if (priorPage === null) {
  return { state: nextState, action: { showFallback: state.fallbackActive } };
}

const direction: 'next' | 'prev' = event.page > priorPage ? 'next' : 'prev';
const target = otherSide(event.side);
return {
  state: {
    ...nextState,
    pendingMirror: target,
    mirrorDeadline: event.now + MIRROR_TIMEOUT_MS,
  },
  action: { sendNavigateTo: target, direction, showFallback: false },
};
```

Update the `MirrorEvent` type to drop the now-unused `origin` field:

```ts
// src/sync/mirrorState.ts — replace the MirrorEvent type
export type MirrorEvent =
  | { type: 'PAGE_CHANGED'; side: Side; page: number; now: number }
  | { type: 'TIMEOUT_CHECK'; now: number }
  | { type: 'MANUAL_REALIGN' };
```

- [ ] **Step 3: Update Task 4's tests for the new signature**

In `src/sync/mirrorState.test.ts`, every `PAGE_CHANGED` event literal drops `origin`. Replace the full file's test bodies with these calls (keep the same `test(...)` names and `expect(...)` assertions already written in Task 4 — only the event literals passed to `reduceMirrorState` change):

```ts
// 'first page-changed event...' — unchanged call:
reduceMirrorState(initialMirrorState, { type: 'PAGE_CHANGED', side: 'jp', page: 1, now: 1000 });

// 'subsequent user page change...':
const afterFirst = reduceMirrorState(initialMirrorState, { type: 'PAGE_CHANGED', side: 'jp', page: 1, now: 1000 }).state;
reduceMirrorState(afterFirst, { type: 'PAGE_CHANGED', side: 'jp', page: 2, now: 1500 });

// 'mirrored confirmation...' — state now carries pendingMirror so the reducer
// recognizes this as the awaited confirmation rather than a new user move:
const state = { ...initialMirrorState, pageJP: 2, pageEN: 1, pendingMirror: 'en' as const, mirrorDeadline: 4500 };
reduceMirrorState(state, { type: 'PAGE_CHANGED', side: 'en', page: 2, now: 1600 });
```

The `'timeout check...'` and `'manual realign...'` tests are unchanged — they never used `origin`.

- [ ] **Step 4: Run all tests, verify they pass**

Run: `npm test`
Expected: PASS (all suites)

- [ ] **Step 5: Update `handleMessage` in ReaderScreen to drop the now-removed `origin` argument**

```tsx
const handleMessage = useCallback((side: Side) => (event: WebViewMessageEvent) => {
  let msg: PageUpdateMessage;
  try {
    msg = JSON.parse(event.nativeEvent.data);
  } catch {
    return;
  }
  if (msg.type !== 'page-update') return;

  setMirrorState((prev) => {
    const { state, action } = reduceMirrorState(prev, {
      type: 'PAGE_CHANGED', side, page: msg.page, now: Date.now(),
    });
    if (action.sendNavigateTo && action.direction) {
      sendNavigate(action.sendNavigateTo, action.direction);
    }
    return state;
  });
}, [sendNavigate]);
```

And update both `onMessage` props to `onMessage={handleMessage('jp')}` / `onMessage={handleMessage('en')}`.

- [ ] **Step 6: Manually verify on device**

Run: `npx expo start`, log into both sites, open the same chapter/page range on both, turn a page on one side, and confirm the other side follows within ~3 seconds or the fallback overlay condition (`mirrorState.fallbackActive`) becomes true (no UI for it yet — check via a temporary `console.log(mirrorState)` — removed after Task 8 adds the real overlay).

- [ ] **Step 7: Commit**

```bash
git add src/screens/ReaderScreen.tsx src/sync/mirrorState.ts src/sync/mirrorState.test.ts
git commit -m "feat: wire mirror state machine into ReaderScreen, fix mirror-loop tracking"
```

---

### Task 8: Manual realign overlay

**Files:**
- Create: `src/components/SyncOverlay.tsx`
- Modify: `src/screens/ReaderScreen.tsx`

**Interfaces:**
- Consumes: `MirrorState` shape from Task 4 (`pageJP`, `pageEN`, `fallbackActive`).
- Produces: `SyncOverlay` component (default export), props `{ pageJP: number | null; pageEN: number | null; visible: boolean; onRealign: () => void }`.

- [ ] **Step 1: Write the overlay component**

```tsx
// src/components/SyncOverlay.tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

interface SyncOverlayProps {
  pageJP: number | null;
  pageEN: number | null;
  visible: boolean;
  onRealign: () => void;
}

export default function SyncOverlay({ pageJP, pageEN, visible, onRealign }: SyncOverlayProps) {
  if (!visible) return null;
  return (
    <View style={styles.bar}>
      <Text style={styles.text}>JP: {pageJP ?? '–'} | EN: {pageEN ?? '–'}</Text>
      <Pressable onPress={onRealign} style={styles.button}>
        <Text style={styles.buttonText}>Riallinea</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)', padding: 8,
  },
  text: { color: 'white' },
  button: { backgroundColor: '#444', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  buttonText: { color: 'white' },
});
```

- [ ] **Step 2: Wire it into ReaderScreen**

```tsx
// src/screens/ReaderScreen.tsx — add import and render
import SyncOverlay from '../components/SyncOverlay';
import { MIRROR_TIMEOUT_MS } from '../sync/mirrorState'; // already imported if needed elsewhere

// inside the component, add:
const handleRealign = useCallback(() => {
  setMirrorState((prev) => reduceMirrorState(prev, { type: 'MANUAL_REALIGN' }).state);
}, []);

// change the returned JSX to wrap in a Fragment/View and add the overlay:
return (
  <View style={styles.container}>
    <WebView /* jp, unchanged */ />
    <WebView /* en, unchanged */ />
    <SyncOverlay
      pageJP={mirrorState.pageJP}
      pageEN={mirrorState.pageEN}
      visible={mirrorState.fallbackActive}
      onRealign={handleRealign}
    />
  </View>
);
```

Remove the temporary `console.log(mirrorState)` from Task 7 Step 6 if still present.

- [ ] **Step 3: Manually verify on device**

Run: `npx expo start`. Trigger a mirror failure by turning a page on one side while the other side is not actually loaded to a matching chapter (so mirroring can't land correctly) — confirm the overlay appears within ~3 seconds showing both page numbers, and that tapping "Riallinea" hides it.

- [ ] **Step 4: Commit**

```bash
git add src/components/SyncOverlay.tsx src/screens/ReaderScreen.tsx
git commit -m "feat: add manual realign overlay for failed page mirroring"
```

---

### Task 9: End-to-end verification

**Files:** none (manual verification pass over the whole app)

**Interfaces:** none — this task consumes the finished app as a whole.

- [ ] **Step 1: Full read-through smoke test**

On a real device (or emulator) running the app via `npx expo start`:
1. Log into Shonen Jump+ in the JP pane and MangaPlus in the EN pane.
2. Search and open the same series/chapter in both.
3. Turn pages forward and backward on each side in turn; confirm the other side follows.
4. Zoom/pan on each side independently; confirm the native reading experience is unaffected (per the Global Constraints — no custom viewer).
5. Deliberately desync (e.g. jump ahead on one side using the site's own chapter navigation) and confirm the realign overlay appears and "Riallinea" clears it.

- [ ] **Step 2: Record any gaps found**

If any step in Step 1 fails, note it in `docs/superpowers/notes/` as a short dated file (what failed, on which site, suspected cause) rather than silently patching around it — this becomes the input for a follow-up task/plan.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: v1 end-to-end verification pass"
git push
```
