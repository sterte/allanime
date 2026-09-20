import {
  reduceMirrorState,
  initialMirrorState,
  MIRROR_TIMEOUT_MS,
} from './mirrorState';

test('first page report immediately targets the other side using the current delta', () => {
  const state = { ...initialMirrorState, pageDelta: 2 };
  const { state: next, action } = reduceMirrorState(state, {
    type: 'PAGE_CHANGED', side: 'en', page: 1, now: 1000,
  });
  expect(action).toEqual({ sendNavigateTo: 'jp', targetPage: 3 });
  expect(next.pendingMirror).toBe('jp');
  expect(next.mirrorDeadline).toBe(1000 + MIRROR_TIMEOUT_MS);
});

test('EN page change targets JP at page + delta', () => {
  const state = { ...initialMirrorState, pageDelta: 2, pageEN: 1, pageJP: 3 };
  const { action } = reduceMirrorState(state, {
    type: 'PAGE_CHANGED', side: 'en', page: 5, now: 1000,
  });
  expect(action).toEqual({ sendNavigateTo: 'jp', targetPage: 7 });
});

test('JP page change targets EN at page - delta', () => {
  const state = { ...initialMirrorState, pageDelta: 2, pageEN: 1, pageJP: 3 };
  const { action } = reduceMirrorState(state, {
    type: 'PAGE_CHANGED', side: 'jp', page: 10, now: 1000,
  });
  expect(action).toEqual({ sendNavigateTo: 'en', targetPage: 8 });
});

test('negative delta targets the other side below its page number', () => {
  const state = { ...initialMirrorState, pageDelta: -2, pageEN: 2, pageJP: 0 };
  const { action } = reduceMirrorState(state, {
    type: 'PAGE_CHANGED', side: 'en', page: 2, now: 1000,
  });
  expect(action).toEqual({ sendNavigateTo: 'jp', targetPage: 0 });
});

test('a page report from the side we are awaiting a mirror from is absorbed, no re-trigger', () => {
  const state = { ...initialMirrorState, pageEN: 1, pageJP: 3, pendingMirror: 'jp' as const, mirrorDeadline: 4500 };
  const { state: next, action } = reduceMirrorState(state, {
    type: 'PAGE_CHANGED', side: 'jp', page: 3, now: 1600,
  });
  expect(next.pendingMirror).toBeNull();
  expect(next.mirrorDeadline).toBeNull();
  expect(action.sendNavigateTo).toBeUndefined();
});

test('timeout check clears a stale pending mirror', () => {
  const state = { ...initialMirrorState, pendingMirror: 'jp' as const, mirrorDeadline: 4500 };
  const { state: next } = reduceMirrorState(state, { type: 'TIMEOUT_CHECK', now: 5000 });
  expect(next.pendingMirror).toBeNull();
  expect(next.mirrorDeadline).toBeNull();
});

test('timeout check before the deadline does nothing', () => {
  const state = { ...initialMirrorState, pendingMirror: 'jp' as const, mirrorDeadline: 4500 };
  const { state: next } = reduceMirrorState(state, { type: 'TIMEOUT_CHECK', now: 4000 });
  expect(next.pendingMirror).toBe('jp');
});

test('setting a new delta with JP already known resyncs EN to JP - delta', () => {
  const state = { ...initialMirrorState, pageJP: 10, pageEN: 10, pageDelta: 0 };
  const { state: next, action } = reduceMirrorState(state, { type: 'SET_DELTA', delta: 3 });
  expect(next.pageDelta).toBe(3);
  expect(action).toEqual({ sendNavigateTo: 'en', targetPage: 7 });
});

test('setting a new delta before any page is known just records it', () => {
  const { state: next, action } = reduceMirrorState(initialMirrorState, { type: 'SET_DELTA', delta: 3 });
  expect(next.pageDelta).toBe(3);
  expect(action).toEqual({});
});
