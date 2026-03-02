# BKW Solar Dashboard

Ein lokales Solar-Monitoring-Dashboard für OpenDTU-Wechselrichter, gebaut mit **SvelteKit + Node.js + SQLite**.

---

## Features

- **Live-Dashboard** – Echtzeit-Leistung, Temperatur, Ertrag pro Wechselrichter
- **Historischer Verlauf** – Tages- und Monatsertrag als Balkendiagramme
- **Ersparnis-Berechnung** – Fixer Tarif (ct/kWh) oder live via [Spotty Energie](https://spottyenergie.at/) API
- **Admin-Bereich** – Wechselrichter, Benutzer, Einstellungen, Logs
- **Automatische Synchronisation** – Konfigurierbares Intervall via node-cron
- **Tages-Snapshots** – Automatisch täglich 23:55 Uhr

---

## Tech Stack

| Layer | Technologie |
|---|---|
| Framework | SvelteKit 2 + Svelte 5 |
| Runtime | Node.js 22 (built-in `node:sqlite`) |
| Datenbank | SQLite (via `node:sqlite` – kein ORM) |
| Adapter | `@sveltejs/adapter-node` |
| CSS | Bootstrap 5 + Bootstrap Icons (CDN) |
| Charts | Chart.js 4 (CDN, dynamisch geladen) |
| Scheduler | node-cron |
| Auth | bcryptjs, Cookie-Session (eigene SQLite-Implementierung) |

---

## Voraussetzungen

- **Node.js ≥ 22** (wegen `node:sqlite` built-in)
- Kein externer Datenbankserver erforderlich

---

## Installation

```bash
# Repository klonen
git clone git@github.com:aiagenttom/bkw.git
cd bkw

# Abhängigkeiten installieren
npm install --legacy-peer-deps
```

---

## Starten

### Development
```bash
npm run dev
```
Öffnet die App unter `http://localhost:5173`.

### Production Build
```bash
# Build erzeugen (muss außerhalb von gemounteten FUSE-Dateisystemen ausgeführt werden)
npm run build

# Server starten
npm run start
```
Der Produktionsserver läuft standardmäßig auf Port **3000**.

---

## Umgebungsvariablen

| Variable | Default | Beschreibung |
|---|---|---|
| `BKW_DATA_DIR` | `~/.bkw-data` | Verzeichnis für die SQLite-Datenbank |
| `BKW_DB_PATH` | `~/.bkw-data/bkw.db` | Absoluter Pfad zur DB-Datei |
| `PORT` | `3000` | HTTP-Port |

---

## Standard-Zugangsdaten

Beim ersten Start wird automatisch ein Admin-Account erstellt:

| Feld | Wert |
|---|---|
| Benutzername | `admin` |
| Passwort | `admin` |

> **Bitte nach dem ersten Login unter Admin → Users das Passwort ändern.**

---

## Konfiguration

Alle Einstellungen sind im Admin-Bereich unter **Inverter Settings** zu finden:

| Einstellung | Beschreibung |
|---|---|
| API Base URL | Nginx-Proxy-Basis-URL für OpenDTU |
| Sync Interval (min) | Wie oft Daten von OpenDTU geholt werden |
| Auto-refresh (s) | Dashboard-Aktualisierungsintervall |
| Tariff Mode | `fixed` (ct/kWh) oder `spotty` (live Börsenpreis) |
| Spotty API URL | Endpunkt für Spotty Energie Preisabruf |
| UTC Offset (h) | Zeitzone (1 = CET, 2 = CEST) |

Pro Wechselrichter kann der Tarif-Modus individuell überschrieben werden.

---

## Datenbank

Die SQLite-Datenbank wird beim ersten Start automatisch angelegt und migriert. Der Standardpfad ist `~/.bkw-data/bkw.db`.

Für Backups genügt es, diese Datei zu kopieren (App sollte dabei gestoppt sein oder WAL-Mode muss unterstützt werden).

---

## Projektstruktur

```
src/
├── hooks.server.js       # Cron-Jobs, Session-Auth, Activity-Logging
├── lib/
│   ├── db.js             # Datenbankinitialisierung, Schema, Migrationen, Seeds
│   ├── session.js        # Cookie-Session via SQLite
│   └── sync.js           # OpenDTU-Sync, Spotty-Preise, Tages-Snapshots
└── routes/
    ├── +page.svelte      # Live-Dashboard
    ├── history/          # Historische Tagesdaten (Bar Charts)
    ├── admin/            # Admin-Bereich (Auth-geschützt)
    │   ├── inverters/    # Wechselrichter & Global Settings
    │   ├── daily/        # Tages-History Verwaltung
    │   ├── users/        # Benutzerverwaltung
    │   └── ...           # Logs, Performance, Automations
    ├── api/              # JSON-Endpunkte für Dashboard-Charts
    ├── login/            # Login-Seite
    └── logout/           # Logout-Handler
```

---

## License

Privates Projekt – alle Rechte vorbehalten.
