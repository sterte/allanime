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
  | { type: 'PAGE_CHANGED'; side: Side; page: number; now: number }
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

  // If this is the side we're waiting on to confirm a mirror we requested,
  // treat it as that confirmation rather than a new user-driven move —
  // otherwise the two sides would keep re-triggering each other forever.
  const isAwaitedMirrorConfirmation = state.pendingMirror === event.side;
  if (isAwaitedMirrorConfirmation) {
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
