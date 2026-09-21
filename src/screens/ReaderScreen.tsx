import React, { useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Pressable, Text, Animated, PanResponder, ScrollView, Alert, Platform } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MANGAPLUS_INJECTED_SCRIPT } from '../webview/injectedScripts/mangaplus';
import { SHONENJUMPPLUS_INJECTED_SCRIPT } from '../webview/injectedScripts/shonenjumpplus';
import { androidTransformZoomScript, androidImageWidthZoomScript } from '../webview/injectedScripts/androidPinchZoom';
import { PageUpdateMessage, NavigateCommand, Side } from '../webview/messages';
import { reduceMirrorState, initialMirrorState, MirrorState } from '../sync/mirrorState';
import { Bookmark, loadBookmarks, saveBookmarks } from '../storage/bookmarks';

const JP_INJECTED_SCRIPT = Platform.OS === 'android'
  ? SHONENJUMPPLUS_INJECTED_SCRIPT + androidTransformZoomScript()
  : SHONENJUMPPLUS_INJECTED_SCRIPT;
const EN_INJECTED_SCRIPT = Platform.OS === 'android'
  ? MANGAPLUS_INJECTED_SCRIPT + androidImageWidthZoomScript('.zao-image')
  : MANGAPLUS_INJECTED_SCRIPT;

const DRAWER_WIDTH = 260;
const EDGE_ZONE_WIDTH = 24;

const JP_HOME = 'https://shonenjumpplus.com/';
const EN_HOME = 'https://mangaplus.shueisha.co.jp/';

export default function ReaderScreen() {
  const insets = useSafeAreaInsets();
  const jpWebViewRef = useRef<WebView>(null);
  const enWebViewRef = useRef<WebView>(null);
  const [splitDirection, setSplitDirection] = useState<'row' | 'column'>('column');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const dragStartValue = useRef(-DRAWER_WIDTH);

  const setDrawer = (open: boolean) => {
    setDrawerOpen(open);
    Animated.timing(drawerAnim, {
      toValue: open ? 0 : -DRAWER_WIDTH,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const edgePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => evt.nativeEvent.pageX < EDGE_ZONE_WIDTH,
      onMoveShouldSetPanResponder: (evt, gesture) =>
        evt.nativeEvent.pageX < EDGE_ZONE_WIDTH && Math.abs(gesture.dx) > 5,
      onPanResponderGrant: () => {
        dragStartValue.current = -DRAWER_WIDTH;
        drawerAnim.setValue(dragStartValue.current);
      },
      onPanResponderMove: (_evt, gesture) => {
        const next = Math.min(0, Math.max(-DRAWER_WIDTH, dragStartValue.current + gesture.dx));
        drawerAnim.setValue(next);
      },
      onPanResponderRelease: (_evt, gesture) => {
        const shouldOpen = dragStartValue.current + gesture.dx > -DRAWER_WIDTH / 2;
        setDrawer(shouldOpen);
      },
    })
  ).current;

  const [jpSource, setJpSource] = useState({ uri: JP_HOME });
  const [enSource, setEnSource] = useState({ uri: EN_HOME });
  const pendingRestorePage = useRef<{ jp: number | null; en: number | null }>({ jp: null, en: null });

  const jpCurrent = useRef({ url: JP_HOME, title: '' });
  const enCurrent = useRef({ url: EN_HOME, title: '' });

  const navigateTo = useCallback((side: Side, url: string) => {
    // A cache-busting query param forces the `source` prop to change even
    // when navigating back to a URL that's already the last-set value —
    // otherwise react-native-webview sees no diff and does nothing, since
    // jpSource/enSource never track link clicks made inside the WebView.
    const target = { uri: url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now() };
    if (side === 'jp') setJpSource(target);
    else setEnSource(target);
  }, []);

  const goToLogin = (side: 'jp' | 'en') => {
    navigateTo(side, side === 'jp' ? JP_HOME : EN_HOME);
  };

  const [mirrorState, setMirrorState] = useState<MirrorState>(initialMirrorState);

  const sendNavigate = useCallback((side: Side, targetPage: number) => {
    const ref = side === 'jp' ? jpWebViewRef : enWebViewRef;
    const command: NavigateCommand = { type: 'navigate', targetPage };
    ref.current?.postMessage(JSON.stringify(command));
  }, []);

  // sendNavigate is a real side effect (posts a message into a WebView).
  // Reading a ref immediately after calling setMirrorState assumed the
  // updater had already run by then — not guaranteed under React's
  // automatic batching, so the ref could still hold a stale (or not-yet-set)
  // value depending on scheduling. The sound version: the updater only
  // computes and stores the pending action in real state; a useEffect fires
  // the side effect once React has actually committed it.
  interface PendingNavigateAction { sendNavigateTo: Side; targetPage: number; }
  const [pendingNavigate, setPendingNavigate] = useState<PendingNavigateAction | null>(null);

  useEffect(() => {
    if (!pendingNavigate) return;
    sendNavigate(pendingNavigate.sendNavigateTo, pendingNavigate.targetPage);
  }, [pendingNavigate, sendNavigate]);

  // Curried factories like `handleMessage(side)` produce a brand-new
  // function every render, so the WebView's onMessage prop identity churns
  // on every render even though the outer function is memoized. If
  // react-native-webview re-subscribes its native message listener whenever
  // that prop reference changes, an event landing during that window could
  // be dropped — plausible contributor to page-updates going missing. Kept
  // stable instead: one memoized handler plus two thin per-side wrappers.
  const handlePageUpdate = useCallback((side: Side, event: WebViewMessageEvent) => {
    let msg: PageUpdateMessage;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type !== 'page-update') return;

    const currentRef = side === 'jp' ? jpCurrent : enCurrent;
    currentRef.current = { url: msg.url, title: msg.title };

    setMirrorState((prev) => {
      const { state, action } = reduceMirrorState(prev, {
        type: 'PAGE_CHANGED', side, page: msg.page, now: Date.now(),
      });
      if (action.sendNavigateTo && action.targetPage !== undefined) {
        setPendingNavigate({ sendNavigateTo: action.sendNavigateTo, targetPage: action.targetPage });
      }
      return state;
    });
  }, []);

  const handleJpMessage = useCallback(
    (event: WebViewMessageEvent) => handlePageUpdate('jp', event),
    [handlePageUpdate]
  );
  const handleEnMessage = useCallback(
    (event: WebViewMessageEvent) => handlePageUpdate('en', event),
    [handlePageUpdate]
  );

  const handleLoadEndForSide = useCallback((side: Side) => {
    const page = pendingRestorePage.current[side];
    if (page === null) return;
    pendingRestorePage.current[side] = null;
    // ponytail: fixed delay instead of confirming the injected script's
    // message listener is actually registered yet — simplest thing that
    // works; revisit if restores prove flaky on slower devices.
    setTimeout(() => sendNavigate(side, page), 300);
  }, [sendNavigate]);

  const handleJpLoadEnd = useCallback(() => handleLoadEndForSide('jp'), [handleLoadEndForSide]);
  const handleEnLoadEnd = useCallback(() => handleLoadEndForSide('en'), [handleLoadEndForSide]);

  useEffect(() => {
    if (!mirrorState.pendingMirror) return;
    const interval = setInterval(() => {
      setMirrorState((prev) => reduceMirrorState(prev, { type: 'TIMEOUT_CHECK', now: Date.now() }).state);
    }, 500);
    return () => clearInterval(interval);
  }, [mirrorState.pendingMirror]);

  const changeDelta = useCallback((step: number) => {
    setMirrorState((prev) => {
      const { state, action } = reduceMirrorState(prev, { type: 'SET_DELTA', delta: prev.pageDelta + step });
      if (action.sendNavigateTo && action.targetPage !== undefined) {
        setPendingNavigate({ sendNavigateTo: action.sendNavigateTo, targetPage: action.targetPage });
      }
      return state;
    });
  }, []);

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  useEffect(() => {
    loadBookmarks().then(setBookmarks);
  }, []);

  const addBookmark = useCallback(() => {
    const bookmark: Bookmark = {
      id: String(Date.now()),
      createdAt: Date.now(),
      jpUrl: jpCurrent.current.url,
      jpTitle: jpCurrent.current.title,
      jpPage: mirrorState.pageJP,
      enUrl: enCurrent.current.url,
      enTitle: enCurrent.current.title,
      enPage: mirrorState.pageEN,
      pageDelta: mirrorState.pageDelta,
    };
    setBookmarks((prev) => {
      const next = [bookmark, ...prev];
      saveBookmarks(next);
      return next;
    });
  }, [mirrorState]);

  const deleteBookmark = useCallback((id: string) => {
    setBookmarks((prev) => {
      const next = prev.filter((b) => b.id !== id);
      saveBookmarks(next);
      return next;
    });
  }, []);

  const confirmDeleteBookmark = useCallback((bookmark: Bookmark) => {
    Alert.alert(
      'Eliminare il bookmark?',
      bookmark.jpTitle || bookmark.enTitle || 'Bookmark',
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Elimina', style: 'destructive', onPress: () => deleteBookmark(bookmark.id) },
      ],
    );
  }, [deleteBookmark]);

  const restoreBookmark = useCallback((bookmark: Bookmark) => {
    pendingRestorePage.current = { jp: bookmark.jpPage, en: bookmark.enPage };
    setMirrorState({ ...initialMirrorState, pageDelta: bookmark.pageDelta });
    navigateTo('jp', bookmark.jpUrl);
    navigateTo('en', bookmark.enUrl);
    setDrawer(false);
  }, [navigateTo]);

  return (
    <View style={styles.root}>
      <View style={[styles.splitContainer, { flexDirection: splitDirection }]}>
        <WebView
          ref={jpWebViewRef}
          style={styles.pane}
          source={jpSource}
          injectedJavaScript={JP_INJECTED_SCRIPT}
          onMessage={handleJpMessage}
          onLoadEnd={handleJpLoadEnd}
        />
        <WebView
          ref={enWebViewRef}
          style={styles.pane}
          source={enSource}
          injectedJavaScript={EN_INJECTED_SCRIPT}
          onMessage={handleEnMessage}
          onLoadEnd={handleEnLoadEnd}
        />
      </View>

      {/* Invisible edge strip — swipe right from here to open the drawer */}
      <View
        style={[styles.edgeZone, { top: insets.top, bottom: insets.bottom }]}
        {...edgePanResponder.panHandlers}
      />

      {drawerOpen && (
        <Pressable style={styles.backdrop} onPress={() => setDrawer(false)} />
      )}

      <Animated.View
        style={[
          styles.drawer,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
          { transform: [{ translateX: drawerAnim }] },
        ]}
      >
        <ScrollView contentContainerStyle={styles.drawerContent}>
          <Text style={styles.drawerSectionTitle}>Opzioni</Text>
          <View style={styles.drawerRow}>
            <Text style={styles.drawerRowLabel}>Orientamento</Text>
            <Pressable
              style={({ pressed }) => [styles.smallButton, pressed && styles.smallButtonPressed]}
              onPress={() => setSplitDirection((d) => (d === 'row' ? 'column' : 'row'))}
            >
              <Text style={styles.smallButtonText}>
                {splitDirection === 'row' ? 'Orizzontale' : 'Verticale'}
              </Text>
            </Pressable>
          </View>
          <View style={styles.drawerRow}>
            <Text style={styles.drawerRowLabel}>Scarto pagine (JP = EN {mirrorState.pageDelta >= 0 ? '+' : ''}{mirrorState.pageDelta})</Text>
            <View style={styles.stepper}>
              <Pressable
                style={({ pressed }) => [styles.smallButton, pressed && styles.smallButtonPressed]}
                onPress={() => changeDelta(-1)}
              >
                <Text style={styles.smallButtonText}>-</Text>
              </Pressable>
              <Text style={styles.stepperValue}>{mirrorState.pageDelta}</Text>
              <Pressable
                style={({ pressed }) => [styles.smallButton, pressed && styles.smallButtonPressed]}
                onPress={() => changeDelta(1)}
              >
                <Text style={styles.smallButtonText}>+</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.drawerSectionTitle}>Account</Text>
          <View style={styles.drawerRow}>
            <Text style={styles.drawerRowLabel}>Shonen Jump+ (JP)</Text>
            <Pressable
              style={({ pressed }) => [styles.smallButton, pressed && styles.smallButtonPressed]}
              onPress={() => goToLogin('jp')}
            >
              <Text style={styles.smallButtonText}>Vai al login</Text>
            </Pressable>
          </View>
          <View style={styles.drawerRow}>
            <Text style={styles.drawerRowLabel}>MangaPlus (EN)</Text>
            <Pressable
              style={({ pressed }) => [styles.smallButton, pressed && styles.smallButtonPressed]}
              onPress={() => goToLogin('en')}
            >
              <Text style={styles.smallButtonText}>Vai al login</Text>
            </Pressable>
          </View>

          <View style={styles.bookmarkHeader}>
            <Text style={styles.drawerSectionTitle}>Bookmark</Text>
            <Pressable
              style={({ pressed }) => [styles.smallButton, pressed && styles.smallButtonPressed]}
              onPress={addBookmark}
            >
              <Text style={styles.smallButtonText}>+ Aggiungi</Text>
            </Pressable>
          </View>
          {bookmarks.length === 0 && (
            <Text style={styles.bookmarkEmpty}>Nessun bookmark salvato</Text>
          )}
          {bookmarks.map((bookmark, index) => (
            <Pressable
              key={bookmark.id}
              style={({ pressed }) => [styles.bookmarkRow, pressed && styles.bookmarkRowPressed]}
              onPress={() => restoreBookmark(bookmark)}
              onLongPress={() => confirmDeleteBookmark(bookmark)}
            >
              <Text style={styles.bookmarkTitle} numberOfLines={1}>
                {index + 1}. {bookmark.jpTitle || bookmark.enTitle || 'Bookmark'}
              </Text>
              <Text style={styles.bookmarkSubtitle}>
                JP: {bookmark.jpPage ?? '–'}  EN: {bookmark.enPage ?? '–'}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  splitContainer: { flex: 1 },
  pane: { flex: 1 },
  edgeZone: {
    position: 'absolute', left: 0,
    width: EDGE_ZONE_WIDTH, zIndex: 3,
  },
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 1,
  },
  drawer: {
    position: 'absolute', top: 0, bottom: 0, left: 0,
    width: DRAWER_WIDTH,
    backgroundColor: '#1e1e1e',
    zIndex: 2,
  },
  drawerContent: {
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24,
  },
  drawerSectionTitle: {
    color: '#888', fontSize: 12, textTransform: 'uppercase',
    marginTop: 20, marginBottom: 8,
  },
  drawerRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8,
  },
  drawerRowLabel: { color: 'white', fontSize: 14, flexShrink: 1 },
  smallButton: {
    backgroundColor: '#444', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4,
  },
  smallButtonPressed: { backgroundColor: '#666' },
  smallButtonText: { color: 'white', fontSize: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepperValue: { color: 'white', fontSize: 14, marginHorizontal: 10, minWidth: 20, textAlign: 'center' },
  bookmarkHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 20,
  },
  bookmarkEmpty: { color: '#666', fontSize: 12, fontStyle: 'italic', marginTop: 4 },
  bookmarkRow: {
    backgroundColor: '#2a2a2a', borderRadius: 4, padding: 8, marginTop: 8,
  },
  bookmarkRowPressed: { backgroundColor: '#3a3a3a' },
  bookmarkTitle: { color: 'white', fontSize: 13 },
  bookmarkSubtitle: { color: '#999', fontSize: 11, marginTop: 2 },
});
