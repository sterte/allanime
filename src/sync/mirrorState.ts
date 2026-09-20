import { Side } from '../webview/messages';

export const MIRROR_TIMEOUT_MS = 3000;

export interface MirrorState {
  pageJP: number | null;
  pageEN: number | null;
  /** JP's target page is always EN's page + pageDelta (negative allowed). */
  pageDelta: number;
  pendingMirror: Side | null;
  mirrorDeadline: number | null;
}

export const initialMirrorState: MirrorState = {
  pageJP: null,
  pageEN: null,
  pageDelta: 0,
  pendingMirror: null,
  mirrorDeadline: null,
};

export type MirrorEvent =
  | { type: 'PAGE_CHANGED'; side: Side; page: number; now: number }
  | { type: 'TIMEOUT_CHECK'; now: number }
  | { type: 'SET_DELTA'; delta: number };

export interface MirrorAction {
  sendNavigateTo?: Side;
  targetPage?: number;
}

function otherSide(side: Side): Side {
  return side === 'jp' ? 'en' : 'jp';
}

export function reduceMirrorState(
  state: MirrorState,
  event: MirrorEvent,
): { state: MirrorState; action: MirrorAction } {
  if (event.type === 'SET_DELTA') {
    const nextState: MirrorState = { ...state, pageDelta: event.delta };
    // JP is treated as the anchor when the delta itself changes — resync EN
    // to it rather than guessing which side the user meant to move.
    if (nextState.pageJP !== null) {
      const target = nextState.pageJP - event.delta;
      return {
        state: { ...nextState, pendingMirror: 'en', mirrorDeadline: null },
        action: { sendNavigateTo: 'en', targetPage: target },
      };
    }
    return { state: nextState, action: {} };
  }

  if (event.type === 'TIMEOUT_CHECK') {
    if (state.pendingMirror && state.mirrorDeadline !== null && event.now >= state.mirrorDeadline) {
      return {
        state: { ...state, pendingMirror: null, mirrorDeadline: null },
        action: {},
      };
    }
    return { state, action: {} };
  }

  // PAGE_CHANGED
  const nextState: MirrorState = {
    ...state,
    pageJP: event.side === 'jp' ? event.page : state.pageJP,
    pageEN: event.side === 'en' ? event.page : state.pageEN,
  };

  // If this is the side we're waiting on to confirm a mirror we requested,
  // absorb it rather than treating it as a new move — otherwise the two
  // sides would keep re-triggering each other forever.
  if (state.pendingMirror === event.side) {
    return {
      state: { ...nextState, pendingMirror: null, mirrorDeadline: null },
      action: {},
    };
  }

  const target = event.side === 'en'
    ? event.page + nextState.pageDelta
    : event.page - nextState.pageDelta;
  const targetSide = otherSide(event.side);
  return {
    state: {
      ...nextState,
      pendingMirror: targetSide,
      mirrorDeadline: event.now + MIRROR_TIMEOUT_MS,
    },
    action: { sendNavigateTo: targetSide, targetPage: target },
  };
}
