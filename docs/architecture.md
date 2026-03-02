# Architektur – BKW Solar Dashboard

## Inhalt

- [Überblick](#überblick)
- [Systemkontext](#systemkontext)
- [Komponenten](#komponenten)
- [Datenbankschema](#datenbankschema)
- [Datenfluss](#datenfluss)
- [Request-Lifecycle](#request-lifecycle)
- [Cron-Architektur](#cron-architektur)
- [Authentifizierung](#authentifizierung)
- [Tarif & Ersparnis-Berechnung](#tarif--ersparnis-berechnung)
- [Frontend-Architektur](#frontend-architektur)
- [Technische Entscheidungen](#technische-entscheidungen)

---

## Überblick

BKW ist eine **Single-Server-Webanwendung** für die lokale Überwachung von Photovoltaik-Wechselrichtern. Sie läuft vollständig auf einem lokalen Rechner ohne Cloud-Abhängigkeiten – mit Ausnahme der optionalen Spotty-Energie-API für Börsenpreise.

```
┌─────────────────────────────────────────────────────────────┐
│                        BKW Server                           │
│                   (Node.js 22, Port 3000)                   │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────┐   │
│  │  SvelteKit   │   │  Sync-Service │   │  Cron-Jobs    │   │
│  │  (SSR + API) │   │  (sync.js)   │   │  (node-cron)  │   │
│  └──────┬───────┘   └──────┬───────┘   └──────┬────────┘   │
│         │                  │                   │            │
│         └──────────────────┼───────────────────┘            │
│                            ▼                                │
│                   ┌────────────────┐                        │
│                   │  SQLite (DB)   │                        │
│                   │  node:sqlite   │                        │
│                   └────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
         ▲                              ▲
         │ HTTP (Browser)               │ HTTP (fetch)
         ▼                              ▼
  ┌─────────────┐              ┌──────────────────┐
  │   Browser   │              │ OpenDTU Inverter  │
  │ (Dashboard) │              │  /api/livedata/  │
  └─────────────┘              └──────────────────┘
                                        ▲
                                        │ HTTP (optional)
                                        ▼
                               ┌──────────────────┐
                               │  Spotty Energie  │
                               │   API (Preise)   │
                               └──────────────────┘
```

---

## Systemkontext

| Akteur | Beschreibung |
|--------|-------------|
| **Browser** | Einziger Client; ruft SSR-Seiten und JSON-APIs auf |
| **OpenDTU** | Lokale Firmware auf Wechselrichtern; liefert Echtzeit-Messdaten als JSON |
| **Spotty Energie API** | Externer Dienst; liefert 15-Minuten-Spotpreise (ct/kWh, UTC) |
| **SQLite-Datenbank** | Lokale Datenpersistenz; kein separater DB-Server |

---

## Komponenten

### `src/lib/db.js` – Datenbankschicht

Zentraler **Singleton**. Wird beim ersten Import initialisiert:

1. Öffnet/erstellt die SQLite-Datenbankdatei
2. Führt `CREATE TABLE IF NOT EXISTS` für alle Tabellen aus
3. Führt Migrations-`ALTER TABLE` aus (für bestehende DBs)
4. Spielt Demo-Seeds ein (nur bei leerer DB)

Alle anderen Module importieren diesen Singleton und verwenden ihn direkt – kein Connection-Pooling nötig (SQLite ist single-writer).

---

### `src/lib/sync.js` – Sync-Service

Enthält die gesamte Daten-Akquisitions-Logik:

```
syncAll()
  └── syncInverter(name, apiPath, baseUrl, fullUrl)
        ├── HTTP GET → OpenDTU JSON
        ├── INSERT → sync_live_dtu_<name>   (Rolling Window, max 60)
        └── INSERT → bkw_history             (dauerhaft)

syncSpottyPrices()
  ├── HTTP GET → Spotty API JSON
  └── INSERT OR IGNORE → spotty_prices

syncDaily(date?)
  ├── SELECT MAX(yield_day), ... FROM bkw_history
  ├── [spotty] JOIN spotty_prices → gewichteter Ø-Preis
  └── INSERT OR REPLACE → bkw_daily
```

---

### `src/hooks.server.js` – Middleware

Wird **einmalig beim Serverstart** ausgeführt (Modul-Level-Code):
- Initialisiert alle Cron-Jobs
- Startet den Session-Cleanup-Timer

Wird **bei jeder HTTP-Anfrage** ausgeführt (`handle`-Hook):
- Liest Session-Cookie → setzt `event.locals.user`
- Nach der Antwort: schreibt in `activity_log`

---

### `src/lib/session.js` – Session-Management

Implementiert Cookie-Sessions ohne externe Bibliothek:

```
Browser-Cookie: bkw_sid=<uuid>
                    │
                    ▼
             sessions-Tabelle
             ┌──────┬──────┬─────────┐
             │ sid  │ sess │ expired │
             └──────┴──────┴─────────┘
                         │
                         ▼
             JSON.parse(sess) → { id, username, isAdmin }
```

---

### `src/routes/` – Routing-Schicht

SvelteKit verwendet dateibasiertes Routing. Jede Route besteht aus:

- **`+page.server.js`** – `load()` für SSR-Daten, `actions` für Form-Submissions
- **`+page.svelte`** – Svelte-Komponente (HTML + reaktives JS)
- **`+layout.server.js`** – Auth-Guard oder gemeinsame Daten für alle Kind-Routen

```
routes/
├── (public)
│   ├── /              → Dashboard (Live-Daten + Charts)
│   ├── /history       → Historische Tagesdaten (Bar Charts)
│   ├── /login         → Login-Formular
│   └── /logout        → Session-Destroy
├── /admin/**          → Auth-Guard: nur isAdmin=true
│   ├── /admin/inverters   → Wechselrichter + Settings
│   ├── /admin/daily       → Tages-History + manueller Snapshot
│   └── ...
└── /api/**            → JSON-Endpunkte (kein Auth)
```

---

## Datenbankschema

### Kern-Tabellen

```
users
├── id              INTEGER PK
├── username        TEXT UNIQUE
├── password        TEXT (bcrypt)
├── is_admin        INTEGER
└── last_login      TEXT

inverters
├── id              INTEGER PK
├── name            TEXT UNIQUE
├── api_path        TEXT
├── full_url        TEXT (override)
├── enabled         INTEGER
├── color           TEXT (#hex)
├── price_mode      TEXT (NULL=global, 'fixed', 'spotty')
└── fixed_price_ct  REAL (NULL=global)

app_settings
├── key             TEXT PK
├── value           TEXT
└── label           TEXT
```

### Mess-Daten

```
bkw_history                         sync_live_dtu_<name>
├── id              INTEGER PK       ├── id            INTEGER PK
├── name            TEXT             ├── synced_at     TEXT
├── log_time        TEXT             ├── power_ac      REAL
├── temperature_v   REAL             ├── power_dc      REAL
├── power_dc_v      REAL             ├── yield_day     REAL
├── power_ac_v      REAL             ├── temperature   REAL
├── voltage_ac_v    REAL             ├── producing     INTEGER
├── yield_day       REAL             └── reachable     INTEGER
└── yield_total     REAL             (Rolling Window, max 60 Zeilen)
     INDEX (name, log_time)
```

### Aggregierte Daten

```
bkw_daily                           spotty_prices
├── date            TEXT             ├── ts     TEXT PK  (ISO 8601 UTC)
├── inverter        TEXT             └── price  REAL     (ct/kWh)
├── yield_wh        REAL
├── peak_w          REAL
├── avg_w           REAL
├── min_temp        REAL
├── max_temp        REAL
├── readings        INTEGER
├── savings_eur     REAL
├── avg_price_ct    REAL
└── PRIMARY KEY (date, inverter)
```

### Protokoll-Tabellen

```
automation_log              automation_msg_log        activity_log
├── id                      ├── id                    ├── id
├── automation_name         ├── log_id (FK)           ├── username
├── started_at              ├── msg_timestamp         ├── page_path
├── ended_at                ├── message               ├── method
├── status                  ├── message_type          ├── elapsed_ms
├── successful_rows         └── pk_value              ├── status_code
└── error_rows                                        └── created_at
```

---

## Datenfluss

### Live-Daten (Dashboard)

```
Browser
  │ GET /
  ▼
+page.server.js (load)
  ├── SELECT * FROM inverters WHERE enabled=1
  ├── SELECT * FROM sync_live_dtu_<name> LIMIT 1  (pro Inverter)
  ├── SELECT h.name, MAX, AVG FROM bkw_history JOIN inverters
  └── Ersparnis-Berechnung (yield_day × Preis)
  │
  ▼
+page.svelte
  ├── Live-Cards (Leistung, Ertrag, Ersparnis)
  ├── Summary-Kacheln (Peak, Avg – gefiltert)
  └── Charts (Chart.js, lazy via CDN)
        │ GET /api/chart-data?name=X&date=Y
        ▼
      chart-data/+server.js
        └── SELECT FROM bkw_history WHERE name IN (aktive Inverter)
```

### Sync-Zyklus (Cron)

```
node-cron (*/N min)
  │
  ▼
syncAll()
  │
  ├── FOR each enabled inverter:
  │     HTTP GET OpenDTU → JSON
  │     │
  │     ├── INSERT sync_live_dtu_<name>  (+ DELETE alte > 60)
  │     └── INSERT bkw_history
  │
  └── UPDATE automation_log (SUCCESS/ERROR)

node-cron (55 23 täglich)
  │
  ▼
syncDaily()
  ├── SELECT MAX(yield_day), peak, avg FROM bkw_history WHERE date=heute
  ├── [spotty] JOIN spotty_prices → gewichteter Ø-Preis pro Inverter
  └── INSERT OR REPLACE bkw_daily

node-cron (:05 stündlich)
  │
  ▼
syncSpottyPrices()
  ├── HTTP GET Spotty API → [{from, price}, ...]
  └── INSERT OR IGNORE spotty_prices
```

---

## Request-Lifecycle

```
HTTP Request
      │
      ▼
hooks.server.js (handle)
  ├── getSession(cookies) → locals.user
  ├── resolve(event)  ──────────────────────────────┐
  │                                                  │
  │   ┌──────────────────────────────────────────┐   │
  │   │ SvelteKit Router                         │   │
  │   │                                          │   │
  │   │  +layout.server.js (load)                │   │
  │   │    └── gibt user weiter                  │   │
  │   │                                          │   │
  │   │  admin/+layout.server.js (Auth-Guard)    │   │
  │   │    └── redirect(/login) wenn kein Admin  │   │
  │   │                                          │   │
  │   │  +page.server.js (load | actions)        │   │
  │   │    └── DB-Queries, Business-Logic        │   │
  │   │                                          │   │
  │   │  +page.svelte (SSR → HTML)               │   │
  │   └──────────────────────────────────────────┘   │
  │                                                  │
  └── activity_log INSERT (non-API, non-static)       │
                                                     │
HTTP Response ◄─────────────────────────────────────┘
```

---

## Cron-Architektur

Alle Jobs werden in `hooks.server.js` auf **Modul-Ebene** (außerhalb des `handle`-Hooks) registriert. Das bedeutet: Sie laufen genau einmal, beim ersten Serverstart – nicht bei jedem Request.

```
Server-Start
  │
  ├── scheduleCron()          → liest sync_interval aus DB, startet node-cron
  ├── cron('55 23 * * *')     → syncDaily()
  ├── cron('5 * * * *')       → syncSpottyPrices()
  ├── syncSpottyPrices()      → sofortiger Fetch beim Start
  └── setInterval(30min)      → pruneSessions()
```

> Der Sync-Interval wird einmalig beim Start aus der DB gelesen. Änderungen im Admin werden erst nach einem Neustart aktiv.

---

## Authentifizierung

```
POST /login
  ├── formData: username, password
  ├── SELECT user FROM users WHERE username=?
  ├── bcrypt.compare(password, hash)
  ├── createSession(cookies, { id, username, isAdmin })
  │     └── INSERT sessions (uuid, JSON, expires)
  │         Set-Cookie: bkw_sid=<uuid>; HttpOnly; SameSite=Lax
  └── redirect(/) oder redirect(/admin)

Jeder Request
  ├── Cookie: bkw_sid=<uuid>
  ├── SELECT sess FROM sessions WHERE sid=? AND expired > now()
  └── event.locals.user = JSON.parse(sess)

GET /logout
  ├── DELETE FROM sessions WHERE sid=?
  └── Cookie löschen → redirect(/login)
```

Passwörter werden mit **bcrypt (cost 10)** gehasht. Es gibt kein Passwort-Reset-Feature – Änderungen erfolgen über den Admin-Bereich.

---

## Tarif & Ersparnis-Berechnung

### Tarif-Hierarchie

```
Inverter.price_mode (NULL?)
    │ NULL → globaler Default
    ▼
app_settings.price_mode
    │
    ├── 'fixed'  → Inverter.fixed_price_ct ?? app_settings.fixed_price_ct
    └── 'spotty' → produktionsgewichteter Ø-Spotpreis
```

### Spotty-Preiszuordnung

Jede Messung in `bkw_history` hat einen lokalen `log_time`. Um den passenden Spotpreis zu finden:

```sql
-- Lokale Zeit → UTC → 15-min-Slot
strftime('%Y-%m-%dT%H:', datetime(log_time, '-' || tz_offset_h || ' hours'))
|| printf('%02d:00Z',
    (CAST(strftime('%M', datetime(log_time, '-' || tz_offset_h || ' hours')) AS INTEGER) / 15) * 15
)
```

Beispiel: `log_time = 2026-03-02 14:37:00`, `tz_offset_h = 1`
→ UTC = `2026-03-02T13:37:00Z` → Slot = `2026-03-02T13:30:00Z`

### Ersparnis-Formel

```
savings_eur = yield_wh / 1000 × avg_price_ct / 100

avg_price_ct (spotty) =
  SUM(power_ac_v × price) / SUM(power_ac_v)   [nur Readings mit power_ac_v > 0]
```

---

## Frontend-Architektur

Das Frontend ist **Server-Side Rendered (SSR)** – jede Seite wird auf dem Server gerendert und als HTML ausgeliefert. JavaScript im Browser ist minimal und nur für interaktive Elemente nötig.

### Chart.js – Lazy Loading

Chart.js wird **nicht gebundelt**, sondern zur Laufzeit vom CDN geladen:

```js
// in onMount() – läuft nur im Browser, nicht beim SSR
const { Chart, registerables } = await import(
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'
);
```

Das verhindert SSR-Fehler (Chart.js benötigt `window`/`document`) und hält den Build klein.

### Reaktivität

Svelte 5 mit `$:`-Statements für abgeleitete Werte:

```js
$: visibleInverters = selInv === 'all' ? inverters : inverters.filter(i => i.name === selInv);
$: visibleSummary   = selInv === 'all' ? summary   : summary.filter(s => s.name === selInv);
```

Der Inverter-Filter auf dem Dashboard filtert Live-Cards, Summary-Kacheln, Charts und History-Tabelle gleichzeitig – ohne Server-Roundtrip.

### Auto-Refresh

```js
onMount(() => {
  fetchData();  // initial
  const secs = parseInt(settings.auto_refresh_s || 30);
  if (secs > 0) timer = setInterval(fetchData, secs * 1000);
});

onDestroy(() => { clearInterval(timer); /* Charts zerstören */ });
```

`fetchData()` ruft `/api/chart-data`, `/api/live` und `/api/today-savings` auf und aktualisiert Charts und Live-Cards reaktiv.

---

## Technische Entscheidungen

| Entscheidung | Begründung |
|-------------|-----------|
| **`node:sqlite` statt better-sqlite3** | Built-in seit Node 22 – keine nativen Module, kein Kompilieren, kein Rebuild nach Node-Update |
| **Kein ORM** | Schema ist einfach und stabil; direktes SQL ist schneller, transparenter und einfacher zu debuggen |
| **Kein WAL-Mode** | FUSE-Dateisystem (macOS virtualisierte Umgebung) unterstützt WAL nicht |
| **SvelteKit statt Express+EJS** | ~40% weniger Code, dateibasiertes Routing, SSR out-of-the-box, Form Actions ersetzen POST-Routes sauber |
| **Bootstrap via CDN** | Kein CSS-Build-Step nötig; spart Build-Zeit und Bundle-Größe |
| **Chart.js via CDN + lazy import** | Vermeidet SSR-Fehler, hält Server-Bundle klein |
| **Eigene Session-Implementierung** | Keine Abhängigkeit von express-session; passt nativ zu SvelteKit Cookies-API |
| **Kein CSRF-Check** | `csrf: { checkOrigin: false }` – lokales Dashboard, kein Cross-Site-Risiko |
| **node-cron im Server-Modul** | Läuft genau einmal beim Start, unabhängig von Requests; einfacher als Worker-Threads |
