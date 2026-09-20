import {
  reduceMirrorState,
  initialMirrorState,
  MIRROR_TIMEOUT_MS,
} from './mirrorState';

test('first page-changed event just records state, no navigate command', () => {
  const { state, action } = reduceMirrorState(initialMirrorState, {
    type: 'PAGE_CHANGED', side: 'jp', page: 1, now: 1000,
  });
  expect(state.pageJP).toBe(1);
  expect(action.sendNavigateTo).toBeUndefined();
});

test('subsequent user page change triggers a navigate command to the other side', () => {
  const afterFirst = reduceMirrorState(initialMirrorState, {
    type: 'PAGE_CHANGED', side: 'jp', page: 1, now: 1000,
  }).state;
  const { state, action } = reduceMirrorState(afterFirst, {
    type: 'PAGE_CHANGED', side: 'jp', page: 2, now: 1500,
  });
  expect(action).toEqual({ sendNavigateTo: 'en', direction: 'next', showFallback: false });
  expect(state.pendingMirror).toBe('en');
  expect(state.mirrorDeadline).toBe(1500 + MIRROR_TIMEOUT_MS);
});

test('a page-update on the side we are awaiting a mirror from clears pending state without re-triggering', () => {
  const state = {
    ...initialMirrorState,
    pageJP: 2, pageEN: 1, pendingMirror: 'en' as const, mirrorDeadline: 4500,
  };
  const result = reduceMirrorState(state, {
    type: 'PAGE_CHANGED', side: 'en', page: 2, now: 1600,
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
