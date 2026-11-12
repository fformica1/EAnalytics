# MetricLab

**MetricLab** è una **PWA local-first** per l'analisi multi-sport e salute H24 che unisce ecosistemi diversi (**Garmin Connect**, **Strava**, **Intervals.icu** e file **`.FIT` / `.GPX` / `.ZIP`**) in un'unica interfaccia scura o chiara con accento blu Garmin (`#007CC3`).

> **Privacy & isolamento per utente:** tutti i token, le chiavi API, le attività e i dati fisiologici restano salvati **esclusivamente nel browser dell'utente** (IndexedDB `velopulse-local-db`). Il backend serverless (`/api/garmin`, `/api/intervals`) funge solo da bridge CORS stateless senza database né log.

---

## Funzionalità principali

### 1. Attività & Mappa interattiva
- **Feed Attività** con ricerca, filtri per sport, metriche adattate allo sport (*ciclismo, corsa/trail, nuoto, palestra/pesi*) e anteprima mappa Web Mercator della traccia GPS.
- **Analisi Dettagliata:**
  - Layout stile Strava su mobile (mappa `sticky` grande + pannello scorrevole) e split fisso su desktop (titolo a tutta larghezza, mappa a sinistra e statistiche a destra della stessa altezza).
  - Mappa Leaflet con traccia continua a gradiente sincronizzata per **Velocità/Passo, Frequenza Cardiaca, Altitudine o Pendenza** e zoom animato fluido (`zoomanim`).
  - **Statistiche Complete Garmin:** estrazione completa da `.FIT` e API Garmin (tempi movimento/trascorso/fermo, FC min/media/max, Potenza Reale + Virtual Power Connect IQ, NP, VI, IF, TSS, kJ, dinamiche di pedalata e corsa, fuori sella, quota min/max, VAM, temperatura min/media/max, respirazione, idratazione stimata, Training Load, TE Aerobico/Anaerobico, VO2Max, vasche/SWOLF nel nuoto).
  - **Grafici sincronizzati ECharts** con zoom orizzontale (pinch-to-zoom / Ctrl+rotella), serie a puntini (`scatter`) per metriche biomeccaniche e **rilevamento automatico degli intervalli stile Zwift** (da Lap strutturati o via Schmitt-Trigger + clustering multi-segnale per tutti gli sport).

### 2. Progressi
- **Riepilogo Generale** filtrabile per sport e periodo (`Giorno`, `Mese`, `Anno`) con grafico interattivo.
- **Calendario mensile** ad altezza fissa (6 settimane) con cerchi proporzionali al volume di allenamento e scorrimento a gesture.
- **Storico Record & Stime:** migliori prestazioni su distanze e durate di potenza, stima FTP e metriche storiche per ciclismo, corsa e nuoto.

### 3. Health H24 & Fusione Multi-Ecosistema
- Analisi giornaliera con selettore scorrevole dei giorni e fallback automatico all'ultimo dato valido disponibile.
- Grafici interattivi per **Body Battery**, **Frequenza Cardiaca H24**, **Sonno & Fasi**, **HRV Notturna**, **Stress & SpO2**, **Passi & Calorie** e **Peso**.
- **Motore di fusione cross-ecosistema (`ecosystemMerge.ts`):** unisce i dati giornalieri per data, deduplica gli allenamenti tra sorgenti diverse e calcola una **Body Battery stimata** combinando sonno/HRV/FC a riposo con il carico degli allenamenti quando mancano i dati nativi Garmin.

### 4. Tema Chiaro / Scuro & Impostazioni
- Tema **Chiaro** predefinito con switch immediato **Chiaro / Scuro** salvato in locale (adatta interfaccia, grafici ECharts e mappe).
- Collegamenti in ordine: **Garmin Connect Personal API**, **Strava**, **Intervals.icu** e caricamento diretto di file `.fit`, `.gpx`, `.zip`.

---

## Sviluppo locale

```bash
npm install
npm run dev
```

Build di produzione (TypeScript + Vite + Service Worker PWA):

```bash
npm run build
```

---

## Deploy gratuito consigliato (Cloudflare Pages)

Il progetto include già le **Cloudflare Pages Functions** stateless in `functions/api/`:
- `functions/api/garmin/[[path]].js`
- `functions/api/intervals/[[path]].js`

Configurazione su Cloudflare Pages:
- **Build command:** `npm run build`
- **Build output directory:** `dist`
