import React, { useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Pressable, Text, Animated, PanResponder } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MANGAPLUS_INJECTED_SCRIPT } from '../webview/injectedScripts/mangaplus';
import { SHONENJUMPPLUS_INJECTED_SCRIPT } from '../webview/injectedScripts/shonenjumpplus';
import { PageUpdateMessage, NavigateCommand, Side } from '../webview/messages';
import { reduceMirrorState, initialMirrorState, MirrorState } from '../sync/mirrorState';

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

  const goToLogin = (side: 'jp' | 'en') => {
    const ref = side === 'jp' ? jpWebViewRef : enWebViewRef;
    const uri = side === 'jp' ? JP_HOME : EN_HOME;
    ref.current?.injectJavaScript(`window.location.href = ${JSON.stringify(uri)}; true;`);
  };

  const [mirrorState, setMirrorState] = useState<MirrorState>(initialMirrorState);

  const sendNavigate = useCallback((side: Side, targetPage: number) => {
    const ref = side === 'jp' ? jpWebViewRef : enWebViewRef;
    const command: NavigateCommand = { type: 'navigate', targetPage };
    ref.current?.postMessage(JSON.stringify(command));
  }, []);

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
      if (action.sendNavigateTo && action.targetPage !== undefined) {
        sendNavigate(action.sendNavigateTo, action.targetPage);
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

  const changeDelta = useCallback((step: number) => {
    setMirrorState((prev) => {
      const { state, action } = reduceMirrorState(prev, { type: 'SET_DELTA', delta: prev.pageDelta + step });
      if (action.sendNavigateTo && action.targetPage !== undefined) {
        sendNavigate(action.sendNavigateTo, action.targetPage);
      }
      return state;
    });
  }, [sendNavigate]);

  return (
    <View style={styles.root}>
      <View style={[styles.splitContainer, { flexDirection: splitDirection }]}>
        <WebView
          ref={jpWebViewRef}
          style={styles.pane}
          source={{ uri: JP_HOME }}
          injectedJavaScript={SHONENJUMPPLUS_INJECTED_SCRIPT}
          onMessage={handleMessage('jp')}
        />
        <WebView
          ref={enWebViewRef}
          style={styles.pane}
          source={{ uri: EN_HOME }}
          injectedJavaScript={MANGAPLUS_INJECTED_SCRIPT}
          onMessage={handleMessage('en')}
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
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
          { transform: [{ translateX: drawerAnim }] },
        ]}
      >
        <Text style={styles.drawerSectionTitle}>Opzioni</Text>
        <View style={styles.drawerRow}>
          <Text style={styles.drawerRowLabel}>Orientamento</Text>
          <Pressable
            style={styles.smallButton}
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
            <Pressable style={styles.smallButton} onPress={() => changeDelta(-1)}>
              <Text style={styles.smallButtonText}>-</Text>
            </Pressable>
            <Text style={styles.stepperValue}>{mirrorState.pageDelta}</Text>
            <Pressable style={styles.smallButton} onPress={() => changeDelta(1)}>
              <Text style={styles.smallButtonText}>+</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.drawerSectionTitle}>Account</Text>
        <View style={styles.drawerRow}>
          <Text style={styles.drawerRowLabel}>Shonen Jump+ (JP)</Text>
          <Pressable style={styles.smallButton} onPress={() => goToLogin('jp')}>
            <Text style={styles.smallButtonText}>Vai al login</Text>
          </Pressable>
        </View>
        <View style={styles.drawerRow}>
          <Text style={styles.drawerRowLabel}>MangaPlus (EN)</Text>
          <Pressable style={styles.smallButton} onPress={() => goToLogin('en')}>
            <Text style={styles.smallButtonText}>Vai al login</Text>
          </Pressable>
        </View>
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
    backgroundColor: '#1e1e1e', paddingHorizontal: 16,
    zIndex: 2,
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
  smallButtonText: { color: 'white', fontSize: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepperValue: { color: 'white', fontSize: 14, marginHorizontal: 10, minWidth: 20, textAlign: 'center' },
});
