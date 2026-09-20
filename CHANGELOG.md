# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/).

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
