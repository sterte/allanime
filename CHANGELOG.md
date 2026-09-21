# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [0.2.0] - 2026-09-21

### Added
- Zoom e pan custom (solo Android) per entrambi i pannelli, per aggirare i bug nativi di `react-native-webview` (zoomScale illeggibile, pan rotto dopo un pinch) individuati in 0.1.0 — risolve la limitazione nota segnalata sotto la 0.1.0.
  - JP (Shonen Jump+): trasformazione CSS uniforme su tutta la pagina, con pan quando zoomato.
  - EN (MangaPlus): ridimensionamento diretto della larghezza delle singole immagini pagina (mantenendo le proporzioni), lasciando lo scroll verticale nativo del sito completamente intatto — un approccio diverso da JP perché il tentativo iniziale (stessa trasformazione CSS condivisa) lasciava bordi vuoti sopra/sotto invece di rivelare più contenuto.
- Feedback visivo (tocco che scurisce il pulsante) su tutti i pulsanti del drawer.

### Fixed
- I pulsanti "Vai al login" non navigavano quando l'URL di destinazione coincideva con l'ultimo valore noto della prop `source` della WebView (mai aggiornata durante la navigazione libera dentro il sito) — react-native-webview non rilevava alcun cambiamento e non ricaricava.
- Il mirroring delle pagine da JP verso EN si allineava solo una volta ogni 2-3 cambi pagina invece che ad ogni cambio, per due problemi distinti nella gestione dello stato React: un effetto collaterale (invio del comando di navigazione) eseguito dentro la funzione di aggiornamento dello stato invece che in un `useEffect` dopo il commit, e riferimenti a `onMessage`/`onLoadEnd` che cambiavano identità ad ogni render.
- Lo zoom-out non poteva scendere sotto il livello di apertura della pagina, per un bug nella formula di clamp (valori di scala sotto 1 producevano un intervallo di offset degenere).

### Known limitations
- La configurazione EAS per un development build resta nel progetto (`eas.json`) ma l'indagine sul debug remoto via `chrome://inspect` non è stata conclusa (Expo Go non espone le WebView; servirebbe completare il test col development build già creato).

## [0.1.0] - 2026-09-20

### Added
- Dual WebView reader screen: Shonen Jump+ (giapponese) e MangaPlus (inglese) affiancati, con toggle orientamento orizzontale/verticale.
- Login gestito interamente dalle sessioni delle due WebView — l'app non gestisce né conserva mai credenziali.
- Rilevamento pagina e navigazione via script iniettati per entrambi i siti, con meccanismi di fallback verificati dal vivo (slider nativo / offset di layout per Shonen Jump+, scroll diretto per MangaPlus).
- Sincronizzazione automatica delle pagine tra i due lati tramite una state machine pura e testata, con scarto pagine configurabile (JP = EN + N) impostabile dal drawer.
- Menu a scomparsa (swipe dal bordo sinistro) con opzioni di orientamento, scarto pagine, scorciatoie di login, e sezione Bookmark.
- Bookmark persistenti (AsyncStorage): salvano URL, titolo, pagina e scarto per entrambi i lati; tap per ripristinare, pressione prolungata con conferma per eliminare.
- Rispetto delle barre di sistema Android (status bar / nav bar) tramite `react-native-safe-area-context`.

### Known limitations
- Zoom sincronizzato tra i due lati: non implementato — `zoomScale` non è leggibile in modo affidabile su Android (bug noto di `react-native-webview`, vedi `docs/superpowers/notes/zoom-feasibility.md`).
- Pan verticale sul riquadro Shonen Jump+ dopo uno zoom: comportamento non del tutto chiarito, probabile limite della piattaforma Android WebView. Expo Go non espone le WebView a `chrome://inspect`; è stato creato un development build EAS per il debug remoto, ma l'indagine non è stata conclusa.
