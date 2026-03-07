# BKW Solar Dashboard

Ein lokales Solar-Monitoring-Dashboard für OpenDTU-Wechselrichter, gebaut mit **SvelteKit + Node.js + SQLite**.

---

## Features

- **Live-Dashboard** – Echtzeit-Leistung, Temperatur, Ertrag pro Wechselrichter
- **Historischer Verlauf** – Tages- und Monatsertrag als Balkendiagramme
- **Prognose** – Mehrtages-Solarertragsprognose mit Wetterdaten (Open-Meteo) und EPEX Spotpreisen; Navigation zwischen Heute und den nächsten 6 Tagen sowie historischen Tagen
- **Wetter-Archiv** – Stündliche Wetterdaten werden automatisch in der DB gespeichert und bleiben dauerhaft verfügbar
- **Ersparnis-Berechnung** – Fixer Tarif (ct/kWh) oder live via [Spotty Energie](https://spottyenergie.at/) API
- **Verbrauchsprofil** – Wochentagsbasiertes Lastprofil pro Wechselrichter für Eigenverbrauchsberechnung
- **Admin-Bereich** – Wechselrichter, Benutzer, Einstellungen, Logs, Automations
- **Automatische Synchronisation** – Konfigurierbares Intervall via node-cron
- **Tages-Snapshots** – Automatisch täglich um 23:55 Uhr

---

## Tech Stack

| Layer | Technologie |
|---|---|
| Framework | SvelteKit 2 + Svelte 4 |
| Runtime | Node.js 20+ |
| Datenbank | SQLite (via `better-sqlite3` – kein ORM) |
| Adapter | `@sveltejs/adapter-node` |
| CSS | Bootstrap 5 + Bootstrap Icons (CDN) |
| Charts | Chart.js 4 (dynamisch geladen) |
| Scheduler | node-cron |
| Auth | bcryptjs, Cookie-Session (eigene SQLite-Implementierung) |
| Wetter-API | [Open-Meteo](https://open-meteo.com/) (kostenlos, kein API-Key) |
| Preise | [Spotty Energie](https://spottyenergie.at/) EPEX Spot API |

---

## Voraussetzungen

- **Node.js ≥ 20**
- Kein externer Datenbankserver erforderlich

---

## Installation

```bash
# Repository klonen
git clone git@github.com:aiagenttom/bkw.git
cd bkw

# Abhängigkeiten installieren
npm install
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
npm run build
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

Alle Einstellungen sind im Admin-Bereich zu finden:

| Einstellung | Beschreibung |
|---|---|
| API Base URL | Nginx-Proxy-Basis-URL für OpenDTU |
| Sync Interval (min) | Wie oft Daten von OpenDTU geholt werden |
| Auto-refresh (s) | Dashboard-Aktualisierungsintervall |
| Tariff Mode | `fixed` (ct/kWh) oder `spotty` (live Börsenpreis) |
| Fixed Price (ct/kWh) | Fixer Strompreis |
| MwSt (%) | Mehrwertsteuer |
| Netzgebühr (ct/kWh) | Netzkosten on top |
| Spotty API URL | Endpunkt für Spotty Energie Preisabruf |
| Timezone | IANA-Zeitzone (z.B. `Europe/Vienna`) |

Pro Wechselrichter kann der Tarif-Modus individuell überschrieben werden.

---

## Datenbank

Die SQLite-Datenbank wird beim ersten Start automatisch angelegt und migriert. Standardpfad: `~/.bkw-data/bkw.db`.

Für Backups genügt es, diese Datei zu kopieren (App sollte dabei gestoppt sein).

### Tabellen

| Tabelle | Beschreibung |
|---|---|
| `inverters` | Wechselrichter-Konfiguration (kWp, API-Pfad, Farbe, Tarif) |
| `bkw_history` | Minutengenaue Messwerte pro Wechselrichter |
| `bkw_daily` | Tages-Snapshots (Ertrag, Ersparnis, Temperaturen) |
| `spotty_prices` | EPEX Spot-Preise (15-min Slots, 13 Monate Aufbewahrung) |
| `weather_hourly` | Stündliche Wetterdaten (GHI, Bewölkung, Temperatur) – dauerhaft gespeichert |
| `weather_daily` | Tägliche Wetter-Zusammenfassung (Sonnenstunden, Min/Max Temperatur) |
| `usage_profiles` | Verbrauchsprofile nach Wochentag und Stunde |
| `app_settings` | Globale Konfiguration (Key-Value) |
| `sessions` | Login-Sessions |
| `activity_log` | Seitenaufrufe und Antwortzeiten |

---

## Automatische Hintergrundjobs (Cron)

| Job | Zeitplan | Beschreibung |
|---|---|---|
| Inverter-Sync | Konfig (default: jede Minute) | OpenDTU-Daten abrufen und speichern |
| Spotty-Preise | Jede Stunde (:05) | EPEX Spot-Preise aktualisieren |
| Wetter-Sync | Jede Stunde (:15) | 7-Tage Open-Meteo Forecast speichern |
| Tages-Snapshot | 23:55 täglich | Tagesertrag & Ersparnis berechnen |
| Preis-Bereinigung | 23:55 täglich | Spotpreise älter als 13 Monate löschen |

---

## Projektstruktur

```
src/
├── hooks.server.js       # Cron-Jobs, Session-Auth, Activity-Logging
├── lib/
│   ├── db.js             # Datenbankinitialisierung, Schema, Migrationen, Seeds
│   ├── session.js        # Cookie-Session via SQLite
│   ├── sync.js           # OpenDTU-Sync, Spotty-Preise, Wetter, Tages-Snapshots
│   └── tz.js             # DST-bewusste Timezone-Hilfsfunktionen
└── routes/
    ├── +page.svelte      # Live-Dashboard
    ├── history/          # Historische Tagesdaten (Bar Charts)
    ├── prognose/         # Solarertragsprognose + Wetter + Spotpreise (mehrtägig)
    ├── admin/            # Admin-Bereich (Auth-geschützt)
    │   ├── inverters/    # Wechselrichter & Global Settings
    │   ├── usage-profile/# Verbrauchsprofile
    │   ├── daily/        # Tages-History Verwaltung
    │   ├── users/        # Benutzerverwaltung
    │   └── ...           # Logs, Performance, Automations, Smart Meter
    ├── login/            # Login-Seite
    └── logout/           # Logout-Handler
```

---

## License

Privates Projekt – alle Rechte vorbehalten.
