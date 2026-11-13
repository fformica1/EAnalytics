# EAnalytics

Una web app pensata per chi fa sport e vuole guardare i propri dati senza distrazioni, senza pubblicità e soprattutto **senza regalare i propri dati a server terzi**.

Funziona da qualsiasi browser (desktop e mobile) ed è installabile sul telefono come una normale app (PWA).

---

## Perché EAnalytics?

Le app sportive ufficiali spesso frammentano le informazioni, richiedono abbonamenti o tengono i dati chiusi nel loro ecosistema. EAnalytics fa da punto d'incontro:

- Collega **Garmin Connect**, **Strava** o **Intervals.icu**.
- Oppure trascina dentro direttamente i tuoi file **`.FIT`**, **`.GPX`** o archivi **`.ZIP`**.
- **Privacy totale**: tutti i dati, le credenziali e le tracce restano salvati **esclusivamente sul tuo dispositivo** (nella memoria del browser tramite IndexedDB). Non c'è nessun database esterno che raccoglie o memorizza le tue uscite.

---

## Cosa trovi dentro

- **Mappa e traccia GPS**: visualizzazione fluida della traccia (a tutto schermo su smartphone), con colorazione interattiva in base a pendenza, battito o velocità.
- **Analisi delle uscite**: grafici sincronizzati per potenza, cadenza, altitudine, frequenza cardiaca e rilevamento automatico delle ripetute/intervalli.
- **Progressi e volumi**: calendario mensile con i carichi di lavoro, filtri per sport (ciclismo, corsa, nuoto, palestra) e storico dei record personali.
- **Salute e recupero**: monitoraggio di Body Battery, sonno, variabilità cardiaca (HRV notturna), passi e stress.
- **Tema Chiaro e Scuro**: interfaccia pulita e curata, comoda da leggere sia sotto il sole che di sera.

---

## Come avviarla in locale

Se vuoi eseguire l'app sul tuo computer:

```bash
# Installa i pacchetti
npm install

# Avvia il server di sviluppo
npm run dev
```

L'app sarà disponibile all'indirizzo `http://localhost:5173`.

---

## Pubblicazione (es. Cloudflare Pages)

Per compilare la versione pronta per il web:

```bash
npm run build
```

La cartella di output è `dist/`, già pronta per il deploy su Cloudflare Pages (o qualsiasi hosting statico).
