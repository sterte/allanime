# Manga Dual-Language Reader — Design

Data: 2026-09-20
Repo: https://github.com/sterte/allanime.git

## Problema

Oggi, per confrontare la stessa pagina di un manga in giapponese e in inglese,
si usa uno split-screen manuale su cellulare tra l'app MangaPlus (inglese,
nessun giapponese) e il browser su Shonen Jump+ (solo giapponese, nessuna
altra lingua). Nessuno dei due servizi offre entrambe le lingue da solo, e il
flusso è scomodo: due app separate, nessuna sincronizzazione tra le pagine.

## Obiettivo v1

Un'app che mostri, affiancate e sincronizzate per numero di pagina, la stessa
pagina di un capitolo in giapponese (Shonen Jump+) e in inglese (MangaPlus),
mantenendo l'esperienza di lettura nativa di ciascun sito (zoom, pan, swipe),
per uso personale su dispositivo mobile.

## Ricerche preliminari (verificate, non assunte)

- **Nessuna fonte unica per entrambe le lingue**: MangaPlus non offre mai il
  giapponese (per design — serve il mercato estero, il Giappone ha Shonen
  Jump+); Shonen Jump+ non offre mai altre lingue. Una piattaforma alternativa
  di Shueisha, *Manga Million* (lanciata agosto 2026, 100+ lingue), non è una
  base affidabile: disponibile "per tempo limitato", non è confermato se
  includa il giapponese tra le lingue, e comunque è un catalogo diverso.
  → **Restano necessarie due sorgenti distinte.**
- **Estensioni browser su mobile**: Chrome per Android non ha mai supportato
  le estensioni. Firefox per Android sì (WebExtensions native). Kiwi Browser,
  che permetteva estensioni Chrome su Android, è stato discontinuato a inizio
  2025. → **Un'estensione browser non è una soluzione mobile affidabile.**
- **Rendering delle pagine (verificato con ispezione DOM/JS live, capitoli
  gratuiti, 2026-09-20)**:
  - MangaPlus: pagine come `<img>` semplici, nessun canvas, meta viewport
    permissivo (non blocca il pinch-zoom nativo), nessuna libreria di
    pan/zoom custom rilevata.
  - Shonen Jump+: ogni pagina è disegnata su un `<canvas>` dedicato
    (822×1200px, contenitori `page-area`) — motore di rendering proprio,
    tipico delle protezioni anti-copia dei siti manga giapponesi. Nessun
    controllo di zoom custom rilevato nel DOM; meta viewport anch'esso
    permissivo.
  - Implicazione: probabilmente entrambi i siti si appoggiano allo zoom
    nativo del browser/WebView piuttosto che a motori di zoom custom
    incompatibili tra loro — ma non esiste un'API JS standard per *impostare*
    programmaticamente lo zoom nativo (solo per leggerlo). Verificabile con
    certezza solo costruendo un prototipo React Native (vedi sezione Zoom).
  - `react-native-webview` supporta `injectedJavaScript` + `postMessage` per
    leggere `canvas.toDataURL()` o lo stato del DOM da una pagina caricata —
    libreria matura, nessuna nuova dipendenza da inventare.

## Approccio scelto

**App ibrida React Native con due WebView live**, una per sito. L'utente fa
login e naviga (ricerca titolo, apre capitolo) direttamente dentro ciascuna
WebView, esattamente come farebbe nel browser/app ufficiale — **l'app non
gestisce, vede o conserva mai credenziali**. Le WebView restano sempre
visibili e interattive: zoom, pan e swipe restano gestiti nativamente da
ciascun sito, nessun viewer custom che ridisegna le immagini.

Scartati:
- *Estensione browser* — bloccata su Chrome Android, dipendenza da Firefox
  Android non accettabile.
- *Backend proxy con credenziali proprie* — richiede conservare in modo
  sicuro due set di credenziali di terze parti e reverse-engineerare le loro
  API di autenticazione/paginazione; più superficie di attacco, più fragile
  ai cambi delle loro API, senza benefici concreti rispetto all'approccio
  scelto.
- *Piattaforma unica (Manga Million o simili)* — instabile, copertura lingue
  non confermata.

## Componenti

- **WebView JP**: carica Shonen Jump+.
- **WebView EN**: carica MangaPlus.
- **Script iniettato per lato** (in ciascuna WebView, via
  `injectedJavaScript`): rileva il numero di pagina corrente (DOM/hook sulla
  navigazione del sito) e lo comunica all'host via `postMessage` a ogni
  cambio pagina; espone anche un comando ricevibile dall'host per
  "vai a pagina successiva/precedente" (usato per il mirroring).
- **Host app** (React Native): mantiene lo stato
  `{pageJP, pageEN, ultimoLatoMosso}`, decide se/come inviare il comando di
  mirroring al lato non ancora aggiornato, e renderizza un overlay sottile
  sopra le due WebView con i due numeri di pagina + pulsante "riallinea"
  quando il mirroring non conferma l'allineamento.

## Data flow — sync pagine

1. L'utente sfoglia/zooma dentro una WebView con l'interfaccia nativa del
   sito (nessuna interferenza).
2. Lo script iniettato rileva il cambio pagina →
   `postMessage({side: 'jp', page: N})` all'host.
3. L'host marca l'evento come "iniziato dall'utente" su quel lato, invia
   comando di mirroring al lato opposto (simulando la navigazione nativa del
   sito).
4. Lo script sul lato opposto esegue il comando, poi conferma con un proprio
   `postMessage` la nuova pagina raggiunta — marcato "mirrorato", per evitare
   che l'host lo reinterpreti come nuovo movimento utente e lo rimbalzi
   indietro (previene loop).
5. Se dopo un breve timeout il lato opposto non conferma la pagina attesa,
   l'host smette di ritentare e mostra l'overlay con i due numeri + pulsante
   "riallinea" (l'utente sfoglia manualmente il lato indietro).

## Selezione titolo/capitolo

Nessun catalogo unificato proprio: l'utente cerca e apre il titolo/capitolo
nella UI nativa di ciascun sito, come fa oggi. L'app non reimplementa ricerca
o catalogo.

## Edge case e gestione errori

- Script iniettato non trova l'elemento pagina (layout del sito cambiato) →
  quel lato mostra un placeholder/segnalazione nell'overlay, non blocca
  l'altro lato. Va marcato in codice con un commento `ponytail:` che indica
  il ceiling (selettore fragile) e il punto da aggiornare.
- Copertine/pagine bonus non corrispondenti tra le due edizioni → gestito dal
  fallback manuale (overlay + riallinea), nessuna euristica di
  image-diffing.
- Mirroring che va in loop (entrambi i lati si "rincorrono") → prevenuto
  marcando esplicitamente gli eventi come "utente" vs "mirrorato" nello
  stato.

## Sync zoom — fuori scope v1, verifica come primo task

Lo zoom sincronizzato (pizzica su una WebView, l'altra zooma sullo stesso
punto) è concettualmente più complesso del mirroring di pagina: richiede
individuare la geometria reale dell'immagine pagina in ciascun DOM, leggere
lo stato di zoom, e riapplicarlo in tempo reale sull'altra WebView. La
ricerca preliminare non ha trovato un blocco strutturale nel *leggere* lo
zoom, ma non esiste un'API JS standard per *impostarlo* — l'unica via
realistica è tramite controlli di zoom nativi a livello di WebView Android,
la cui disponibilità in `react-native-webview` non è verificabile da ricerca.

**Decisione**: fuori scope per v1. Il **primo task tecnico del piano di
implementazione** sarà un piccolo prototipo RN WebView per verificare se i
controlli di zoom nativi sono pilotabili da codice. Se sì, si valuta
l'inclusione; se no, si procede senza e si passa al resto del piano.

## Scope lingue v1

Solo giapponese (Shonen Jump+) + inglese (MangaPlus) — le uniche lingue
garantite sugli stessi titoli su questi due servizi. Altre lingue/fonti
restano fuori scope v1: il confine pulito tra "adapter di acquisizione
pagine" (oggi: WebView + injected script) e "host/overlay" permette di
aggiungere altre fonti in futuro senza riprogettare l'app.

## Distribuzione

Uso strettamente personale. Nessuna pubblicazione su App Store/Play Store
(violerebbe le policy sullo scraping/estrazione di contenuti di altre app) —
build di sviluppo/sideload.

## Stack

React Native + TypeScript. Firebase opzionale, non essenziale: eventuale
persistenza leggera di preferenze/cronologia letture cross-device — nessun
ruolo per le credenziali (che l'app non gestisce mai).

## Testing

- La state machine di mirroring (`{pageJP, pageEN, source} → azione`,
  incluso il timeout/fallback) è l'unica logica non banale: va testata come
  funzione pura, in isolamento, senza bisogno delle WebView reali.
- L'estrazione DOM/canvas nei due siti resta verificata manualmente contro i
  siti reali (dipende da markup live, non testabile in isolamento in modo
  sensato).
