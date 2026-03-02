# Developer Guide – BKW Solar Dashboard

## Inhalt

- [Entwicklungsumgebung einrichten](#entwicklungsumgebung-einrichten)
- [Projektstruktur](#projektstruktur)
- [Datenbank](#datenbank)
- [Authentifizierung & Sessions](#authentifizierung--sessions)
- [Sync-Service](#sync-service)
- [Cron-Jobs](#cron-jobs)
- [Neue Route hinzufügen](#neue-route-hinzufügen)
- [Neuen Wechselrichter anlegen](#neuen-wechselrichter-anlegen)
- [Admin-Bereich erweitern](#admin-bereich-erweitern)
- [API-Endpunkte](#api-endpunkte)
- [App-Einstellungen (app_settings)](#app-einstellungen-app_settings)
- [Build & Deployment](#build--deployment)
- [Bekannte Einschränkungen](#bekannte-einschränkungen)

---

## Entwicklungsumgebung einrichten

```bash
git clone git@github.com:aiagenttom/bkw.git
cd bkw
npm install --legacy-peer-deps   # --legacy-peer-deps wegen Svelte 5 peer deps
npm run dev
```

Die App ist unter `http://localhost:5173` erreichbar. Login: `admin` / `admin`.

> **Node.js ≥ 22 erforderlich** – das Projekt nutzt `node:sqlite` (built-in, experimentell).
> Alle npm-Scripts übergeben daher `--experimental-sqlite` an Node.

### Wichtige npm-Scripts

| Script | Beschreibung |
|--------|-------------|
| `npm run dev` | Dev-Server mit Hot Reload |
| `npm run build` | Production Build nach `build/` |
| `npm run start` | Production Server starten (`build/index.js`) |
| `npm run preview` | Build lokal vorab ansehen |

---

## Projektstruktur

```
bkw-svelte/
├── src/
│   ├── app.html                  # HTML-Shell (Bootstrap + Icons via CDN)
│   ├── hooks.server.js           # Middleware: Auth, Activity-Log, Cron-Init
│   ├── lib/
│   │   ├── db.js                 # DB-Singleton, Schema, Migrationen, Seeds
│   │   ├── session.js            # Cookie-Session (SQLite-backed)
│   │   └── sync.js               # OpenDTU-Fetch, Spotty-Preise, Tages-Snapshot
│   └── routes/
│       ├── +layout.server.js     # User-Session an alle Seiten übergeben
│       ├── +layout.svelte        # Navbar + Footer (Bootstrap)
│       ├── +page.server.js       # Dashboard: Live-Daten laden
│       ├── +page.svelte          # Live-Dashboard (Chart.js)
│       ├── history/              # Historische Tagesdaten (Bar Charts)
│       ├── login/                # Login-Formular (Form Action)
│       ├── logout/               # Logout (GET → Session löschen)
│       ├── admin/                # Alle Admin-Seiten (Auth-Guard via layout)
│       │   ├── +layout.server.js # Redirect → /login wenn kein Admin
│       │   ├── inverters/        # Wechselrichter + Global Settings
│       │   ├── daily/            # Tages-History + manueller Snapshot
│       │   ├── users/            # Benutzerverwaltung
│       │   ├── automations/      # Automation-Log Ansicht
│       │   ├── activity/         # Activity-Log
│       │   ├── error-log/        # Fehlerprotokoll
│       │   ├── page-performance/ # Seitenleistung
│       │   ├── page-views/       # Seitenaufrufe
│       │   ├── smartmeter/       # Smart-Meter CSV-Import
│       │   └── top-users/        # Top-User-Statistik
│       └── api/
│           ├── chart-data/       # GET: History-Daten für Charts
│           ├── dates/            # GET: Verfügbare Datumseinträge
│           ├── history/          # GET: Raw-History-Daten
│           ├── live/             # GET: Live-Daten aller aktiven Inverter
│           ├── today-savings/    # GET: Heutige Ersparnis pro Inverter
│           └── inverters/[id]/sync/ # POST: Manueller Sync eines Inverters
├── static/
│   └── style.css                 # Globale Styles (Bootstrap-Erweiterungen)
├── docs/                         # Diese Dokumentation
├── .gitignore
├── package.json
├── svelte.config.js
└── vite.config.js
```

---

## Datenbank

### Initialisierung

`src/lib/db.js` exportiert einen **synchronen SQLite-Singleton** (`DatabaseSync` aus `node:sqlite`).
Die DB wird beim ersten Import automatisch erstellt, das Schema angelegt und Seeds eingespielt.

```js
import db from '$lib/db.js';
const rows = db.prepare('SELECT * FROM inverters').all();
```

> **Kein async/await nötig** – `node:sqlite` ist vollständig synchron.

### Schema-Übersicht

| Tabelle | Zweck |
|---------|-------|
| `users` | Login-Accounts (bcrypt-Passwörter) |
| `sessions` | Cookie-Sessions (sid, JSON, Ablaufzeit) |
| `inverters` | Konfigurierte Wechselrichter |
| `app_settings` | Key/Value-Konfiguration |
| `bkw_history` | Minutengenaue Messwerte aller Inverter |
| `sync_live_dtu_<name>` | Rolling-Window (60 Einträge) pro Inverter |
| `bkw_daily` | Tages-Snapshots (Ertrag, Peak, Ersparnis) |
| `spotty_prices` | 15-min Spotpreise (ct/kWh, UTC) |
| `automation_log` | Sync-Ausführungsprotokoll |
| `automation_msg_log` | Detailmeldungen pro Sync-Lauf |
| `activity_log` | HTTP-Anfragen (User, Pfad, Status, ms) |
| `smartmeter` | Smart-Meter Verbrauchsdaten (CSV-Import) |

### Migrationen

Migrationen stehen am Ende von `db.js` als `ALTER TABLE`-Statements mit vorheriger Spaltenprüfung:

```js
const cols = db.prepare('PRAGMA table_info(inverters)').all().map(c => c.name);
if (!cols.includes('price_mode'))
  db.exec('ALTER TABLE inverters ADD COLUMN price_mode TEXT');
```

So kann die App auf bestehende Datenbanken deployt werden, ohne Datenverlust.

### Wichtige Constraints

- **Kein WAL-Mode** – das gemountete FUSE-Dateisystem unterstützt WAL nicht.
- `bkw_daily` hat `PRIMARY KEY (date, inverter)` → `INSERT OR REPLACE` ist sicher.
- `spotty_prices` hat `PRIMARY KEY (ts)` → `INSERT OR IGNORE` verhindert Duplikate.
- `sync_live_dtu_<name>` wird **dynamisch** beim ersten Sync angelegt (`CREATE TABLE IF NOT EXISTS`).

---

## Authentifizierung & Sessions

### Ablauf

1. Login-Formular → Form Action `POST /login` → bcrypt-Vergleich → `createSession()`
2. `hooks.server.js` liest bei **jeder Anfrage** den Session-Cookie `bkw_sid` und hängt das User-Objekt an `event.locals.user`
3. Admin-Routen prüfen in `admin/+layout.server.js` ob `locals.user?.isAdmin` gesetzt ist

### Session-API (`src/lib/session.js`)

```js
import { getSession, createSession, destroySession } from '$lib/session.js';

// Lesen (in hooks.server.js)
const user = getSession(cookies);   // → { id, username, isAdmin } | null

// Erstellen (nach erfolgreichem Login)
createSession(cookies, { id, username, isAdmin });

// Löschen (Logout)
destroySession(cookies);
```

Sessions laufen nach **7 Tagen** ab. Abgelaufene Sessions werden alle 30 Minuten via `setInterval` bereinigt.

---

## Sync-Service

`src/lib/sync.js` enthält vier exportierte Funktionen:

### `syncInverter(name, apiPath, baseUrl, fullUrl)`

Holt Daten von einem OpenDTU-Endpunkt und schreibt sie in:
- `sync_live_dtu_<name>` (Rolling-Window, max. 60 Einträge)
- `bkw_history` (dauerhaft)

URL-Auflösung: `fullUrl` hat Vorrang vor `baseUrl + apiPath`.

### `syncAll()`

Lädt alle aktivierten Wechselrichter aus der DB und ruft `syncInverter` für jeden auf.
Protokolliert das Ergebnis in `automation_log` + `automation_msg_log`.

### `syncSpottyPrices()`

Fetcht 15-min-Spotpreise von der konfigurierten Spotty-API und speichert sie in `spotty_prices`.
`INSERT OR IGNORE` → idempotent, kann beliebig oft aufgerufen werden.

### `syncDaily(date?)`

Erstellt einen Tages-Snapshot in `bkw_daily` für das angegebene Datum (Standard: heute).
Berechnet `savings_eur` je nach Tarif-Modus pro Wechselrichter:

| Modus | Berechnung |
|-------|-----------|
| `fixed` | `yield_wh / 1000 × fixed_price_ct / 100` |
| `spotty` | Produktionsgewichteter Ø-Spotpreis × Ertrag |

Für den Spotty-Modus wird der lokale `log_time` via `tz_offset_h` in UTC umgerechnet und dem nächsten 15-min-Slot zugeordnet.

---

## Cron-Jobs

Alle Cron-Jobs werden **einmalig beim Serverstart** in `hooks.server.js` initialisiert:

| Cron | Ausdruck | Aufgabe |
|------|----------|---------|
| Sync-Interval | `*/N * * * *` | `syncAll()` – N aus `app_settings.sync_interval` |
| Tages-Snapshot | `55 23 * * *` | `syncDaily()` |
| Spotty-Preise | `5 * * * *` | `syncSpottyPrices()` |
| Session-Cleanup | `setInterval 30min` | `pruneSessions()` |

Der Sync-Interval wird beim Start aus der DB gelesen. Eine Änderung im Admin wird **beim nächsten Serverstart** aktiv.

---

## Neue Route hinzufügen

SvelteKit verwendet dateibasiertes Routing. Beispiel: neue Seite `/solar/live`:

```
src/routes/solar/live/
├── +page.server.js    # load() – Daten serverseitig laden
└── +page.svelte       # UI-Komponente
```

**`+page.server.js` Grundgerüst:**

```js
import db from '$lib/db.js';

export async function load() {
  const data = db.prepare('SELECT ...').all();
  return { data };
}

export const actions = {
  save: async ({ request }) => {
    const d = await request.formData();
    // ...
    return { success: 'Gespeichert' };
  }
};
```

**`+page.svelte` Grundgerüst:**

```svelte
<script>
  export let data, form;
</script>

{#if form?.success}<div class="alert alert-success">{form.success}</div>{/if}

<form method="POST" action="?/save">
  <!-- Felder -->
  <button class="btn btn-primary">Speichern</button>
</form>
```

Auth-Guard für Admin-Seiten: Die Datei in `src/routes/admin/` ablegen – das bestehende `admin/+layout.server.js` prüft automatisch auf Admin-Rechte.

---

## Neuen Wechselrichter anlegen

1. Im Admin-Bereich unter **Inverter Settings → Add Inverter**
2. Name, URL (Full URL oder Nginx-Pfad), Farbe und Tarif-Modus eintragen
3. Beim ersten Sync wird automatisch eine `sync_live_dtu_<name>`-Tabelle erstellt

Programmatisch:
```js
db.prepare('INSERT INTO inverters (name, api_path, full_url, color, enabled) VALUES (?,?,?,?,1)')
  .run('Dach', 'opendtu_dach/', null, '#f39c12');
```

---

## Admin-Bereich erweitern

Neue Admin-Seite unter `src/routes/admin/<name>/` anlegen (Authentifizierung wird durch das Admin-Layout automatisch übernommen). Link in `src/routes/+layout.svelte` im Admin-Dropdown ergänzen:

```svelte
<li><a class="dropdown-item" href="/admin/meineseite">
  <i class="bi bi-star me-2"></i>Meine Seite
</a></li>
```

---

## API-Endpunkte

Alle Endpunkte liegen unter `/api/` und sind **nicht auth-geschützt** (lokales Dashboard).

| Endpunkt | Methode | Parameter | Beschreibung |
|----------|---------|-----------|-------------|
| `/api/live` | GET | – | Live-Daten aller aktiven Inverter |
| `/api/chart-data` | GET | `name`, `date` | History-Daten für Charts (nur aktive Inverter) |
| `/api/history` | GET | `name`, `date` | Raw-History-Rows |
| `/api/dates` | GET | `name` | Verfügbare Datumseinträge |
| `/api/today-savings` | GET | – | Heutige Ersparnis pro Inverter |
| `/api/inverters/[id]/sync` | POST | – | Manuellen Sync für einen Inverter auslösen |

**Antwortformat (immer JSON):**
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "Fehlermeldung" }
```

---

## App-Einstellungen (app_settings)

Alle Einstellungen sind Key/Value-Paare in `app_settings`. Lesen:

```js
const value = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('sync_interval')?.value;
```

| Key | Default | Beschreibung |
|-----|---------|-------------|
| `api_base_url` | `https://...` | OpenDTU Nginx-Proxy Basis-URL |
| `sync_interval` | `1` | Sync-Interval in Minuten |
| `auto_refresh_s` | `30` | Dashboard-Refresh in Sekunden |
| `app_name` | `BKW` | App-Titel |
| `spotty_url` | `https://...` | Spotty Energie API URL |
| `tz_offset_h` | `1` | UTC-Offset (1=CET, 2=CEST) |
| `price_mode` | `fixed` | Globaler Tarif-Modus (`fixed`\|`spotty`) |
| `fixed_price_ct` | `30` | Globaler Fixpreis ct/kWh |

---

## Build & Deployment

### Build (muss außerhalb von FUSE-gemounteten Pfaden laufen)

```bash
# Auf dem Mac im bkw-svelte Verzeichnis:
npm run build
```

Der Build-Output liegt in `build/`. Die Datei `build/index.js` ist der Node.js-Server.

### Starten

```bash
node --experimental-sqlite build/index.js
```

Oder via npm:
```bash
npm run start
```

### Umgebungsvariablen

```bash
BKW_DATA_DIR=/var/data/bkw  node --experimental-sqlite build/index.js
# oder
BKW_DB_PATH=/var/data/bkw/bkw.db  node --experimental-sqlite build/index.js
PORT=8080  node --experimental-sqlite build/index.js
```

### Als Hintergrundprozess (macOS launchd / Linux systemd)

Für einen dauerhaften Betrieb empfiehlt sich `pm2`:
```bash
pm2 start "node --experimental-sqlite build/index.js" --name bkw
pm2 save
pm2 startup
```

---

## Bekannte Einschränkungen

| Problem | Ursache | Workaround |
|---------|---------|-----------|
| Kein WAL-Mode | FUSE-Dateisystem | Pragma weggelassen; Write-Lock bei gleichzeitigen Zugriffen möglich |
| Build schlägt fehl auf gemounteten Pfaden | FUSE blockiert `rm -rf` | Build in `/tmp` ausführen, dann kopieren |
| `git push` schlägt fehl auf FUSE | Lockfile-Erstellung | git-Befehle direkt auf dem Host ausführen |
| `sync_interval`-Änderung braucht Neustart | Cron wird einmalig initialisiert | App neustarten nach Änderung |
