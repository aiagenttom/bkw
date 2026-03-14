import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.BKW_DATA_DIR || join(homedir(), '.bkw-data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.BKW_DB_PATH || join(DATA_DIR, 'bkw.db');
const db = new Database(DB_PATH);

db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password   TEXT NOT NULL,
    email      TEXT,
    is_admin   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS bkw_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    log_time      TEXT NOT NULL,
    temperature_v REAL, power_dc_v REAL, current_v REAL,
    power_ac_v REAL, voltage_ac_v REAL, frequency_v REAL,
    power_factor REAL, yield_day REAL, yield_total REAL
  );
  CREATE INDEX IF NOT EXISTS idx_bkw_history ON bkw_history(name, log_time);

  CREATE TABLE IF NOT EXISTS sync_live_dtu_erwin (
    id INTEGER PRIMARY KEY AUTOINCREMENT, synced_at TEXT DEFAULT (datetime('now')),
    serial TEXT, name TEXT, power_ac REAL, current_ac REAL, voltage_ac REAL,
    frequency REAL, power_factor REAL, reactive_power REAL,
    power_dc REAL, current_dc REAL, voltage_dc REAL,
    yield_day REAL, yield_total REAL, temperature REAL, efficiency REAL,
    producing INTEGER, reachable INTEGER
  );
  CREATE TABLE IF NOT EXISTS sync_live_dtu_michi (
    id INTEGER PRIMARY KEY AUTOINCREMENT, synced_at TEXT DEFAULT (datetime('now')),
    serial TEXT, name TEXT, power_ac REAL, current_ac REAL, voltage_ac REAL,
    frequency REAL, power_factor REAL, reactive_power REAL,
    power_dc REAL, current_dc REAL, voltage_dc REAL,
    yield_day REAL, yield_total REAL, temperature REAL, efficiency REAL,
    producing INTEGER, reachable INTEGER
  );
  CREATE TABLE IF NOT EXISTS sync_live_dtu_balkon (
    id INTEGER PRIMARY KEY AUTOINCREMENT, synced_at TEXT DEFAULT (datetime('now')),
    serial TEXT, name TEXT, power_ac REAL, current_ac REAL, voltage_ac REAL,
    frequency REAL, power_factor REAL, reactive_power REAL,
    power_dc REAL, current_dc REAL, voltage_dc REAL,
    yield_day REAL, yield_total REAL, temperature REAL, efficiency REAL,
    producing INTEGER, reachable INTEGER
  );

  CREATE TABLE IF NOT EXISTS smartmeter (
    datum TEXT NOT NULL, zeit_von TEXT NOT NULL, zeit_bis TEXT, verbrauch_kwh REAL,
    PRIMARY KEY (datum, zeit_von)
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT, page_path TEXT, method TEXT DEFAULT 'GET',
    elapsed_ms INTEGER, status_code INTEGER DEFAULT 200,
    error_message TEXT, session_id TEXT, ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(created_at);

  CREATE TABLE IF NOT EXISTS automation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    automation_name TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT, status TEXT DEFAULT 'RUNNING',
    successful_rows INTEGER DEFAULT 0, error_rows INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS automation_msg_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id INTEGER NOT NULL,
    msg_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    message TEXT, message_type TEXT DEFAULT 'INFO', pk_value TEXT
  );

  CREATE TABLE IF NOT EXISTS inverters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    api_path TEXT NOT NULL,
    full_url TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    color TEXT DEFAULT '#3498db',
    price_mode TEXT,       -- NULL = use global default (spotty|fixed)
    fixed_price_ct REAL,   -- NULL = use global default
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY, value TEXT, label TEXT
  );

  CREATE TABLE IF NOT EXISTS bkw_daily (
    date        TEXT NOT NULL,
    inverter    TEXT NOT NULL,
    yield_wh    REAL,
    peak_w      REAL,
    avg_w       REAL,
    min_temp    REAL,
    max_temp    REAL,
    readings    INTEGER,
    savings_eur REAL,
    avg_price_ct REAL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (date, inverter)
  );
  CREATE INDEX IF NOT EXISTS idx_bkw_daily ON bkw_daily(date);

  -- Spotty Energie 15-min spot prices (UTC timestamps, ct/kWh)
  CREATE TABLE IF NOT EXISTS spotty_prices (
    ts     TEXT PRIMARY KEY,  -- ISO 8601 UTC e.g. 2026-03-02T00:00:00Z
    price  REAL NOT NULL      -- ct/kWh
  );
  CREATE INDEX IF NOT EXISTS idx_spotty_ts ON spotty_prices(ts);

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expired TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS usage_profiles (
    inverter_id INTEGER NOT NULL,
    weekday     INTEGER NOT NULL,  -- 0=Mo, 1=Di, ..., 6=So
    hour        INTEGER NOT NULL,  -- 0–23
    kw          REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (inverter_id, weekday, hour)
  );

  CREATE TABLE IF NOT EXISTS powerbanks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    inverter_id INTEGER NOT NULL UNIQUE REFERENCES inverters(id) ON DELETE CASCADE,
    capacity_wh REAL    NOT NULL DEFAULT 1600,  -- Speicherkapazität in Wh
    discharge_w REAL    NOT NULL DEFAULT 200,   -- Konstante Abgabeleistung in W
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// Shelly Pro 3EM – Stromverbrauchsmessung (live readings, 1-min resolution)
db.exec(`
  CREATE TABLE IF NOT EXISTS shelly_readings (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    total_act_power  REAL,   -- Gesamtverbrauch in W (Summe aller 3 Phasen)
    a_act_power      REAL,   -- Phase L1 in W
    b_act_power      REAL,   -- Phase L2 in W
    c_act_power      REAL,   -- Phase L3 in W
    a_voltage        REAL,   -- Phase L1 Spannung in V
    b_voltage        REAL,   -- Phase L2 Spannung in V
    c_voltage        REAL,   -- Phase L3 Spannung in V
    total_energy_wh  REAL    -- Kumulierter Gesamtverbrauch in Wh (von EMData)
  );
  CREATE INDEX IF NOT EXISTS idx_shelly_readings_time ON shelly_readings(created_at);
`);

// Anker SOLIX Powerbank live readings (raw, 5-min resolution)
db.exec(`
  CREATE TABLE IF NOT EXISTS anker_readings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_sn   TEXT,
    soc         REAL,          -- Ladestand in % (0-100)
    charge_w    REAL,          -- Ladeleistung in W
    discharge_w REAL,          -- Entladeleistung in W
    state       TEXT,          -- z.B. "charging", "discharging", "standby"
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_anker_readings_time ON anker_readings(created_at);
`);

// Tägliche Verdichtung der Anker-Rohdaten (bleibt dauerhaft erhalten, auch nach Prune)
db.exec(`
  CREATE TABLE IF NOT EXISTS anker_daily (
    date         TEXT PRIMARY KEY,  -- YYYY-MM-DD (Lokalzeit)
    avg_soc      REAL,              -- Mittlerer Ladestand in %
    min_soc      REAL,              -- Minimum SOC
    max_soc      REAL,              -- Maximum SOC
    charge_wh    REAL,              -- Gesamt-Ladeenergie des Tages in Wh
    discharge_wh REAL,              -- Gesamt-Entladeenergie des Tages in Wh
    readings     INTEGER            -- Anzahl der Messungen
  );
`);

// Weather storage tables
db.exec(`
  CREATE TABLE IF NOT EXISTS weather_hourly (
    date            TEXT NOT NULL,   -- YYYY-MM-DD (local timezone)
    hour            INTEGER NOT NULL, -- 0-23
    ghi             REAL,            -- shortwave_radiation W/m²
    direct_radiation REAL,
    cloud_cover     REAL,            -- %
    temperature     REAL,            -- °C
    wind_speed      REAL,            -- km/h
    PRIMARY KEY (date, hour)
  );

  CREATE TABLE IF NOT EXISTS weather_daily (
    date                TEXT PRIMARY KEY, -- YYYY-MM-DD (local timezone)
    sunshine_duration_h REAL,
    radiation_sum       REAL,
    temp_max            REAL,
    temp_min            REAL
  );
`);

// Fehlende Indizes nachträglich anlegen (Performance-Fix)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_automation_msg_log_id  ON automation_msg_log(log_id);
  CREATE INDEX IF NOT EXISTS idx_automation_log_started ON automation_log(started_at DESC);
`);

// Automation-Logs auf 500 Einträge begrenzen (verhindert unbegrenztes Wachstum)
db.exec(`
  DELETE FROM automation_msg_log
  WHERE log_id NOT IN (SELECT id FROM automation_log ORDER BY started_at DESC LIMIT 500);
  DELETE FROM automation_log
  WHERE id NOT IN (SELECT id FROM automation_log ORDER BY started_at DESC LIMIT 500);
`);

// Migrations
const invCols = db.prepare('PRAGMA table_info(inverters)').all().map(c => c.name);
if (!invCols.includes('full_url'))
  db.exec('ALTER TABLE inverters ADD COLUMN full_url TEXT');
if (!invCols.includes('price_mode'))
  db.exec('ALTER TABLE inverters ADD COLUMN price_mode TEXT');
if (!invCols.includes('fixed_price_ct'))
  db.exec('ALTER TABLE inverters ADD COLUMN fixed_price_ct REAL');
if (!invCols.includes('live_url'))
  db.exec('ALTER TABLE inverters ADD COLUMN live_url TEXT');
if (!invCols.includes('kwp'))
  db.exec('ALTER TABLE inverters ADD COLUMN kwp REAL DEFAULT 0');
if (!invCols.includes('serial'))
  db.exec('ALTER TABLE inverters ADD COLUMN serial TEXT');

const histCols = db.prepare('PRAGMA table_info(bkw_history)').all().map(c => c.name);
if (!histCols.includes('dc_strings'))
  db.exec('ALTER TABLE bkw_history ADD COLUMN dc_strings TEXT');

const dailyCols = db.prepare('PRAGMA table_info(bkw_daily)').all().map(c => c.name);
if (!dailyCols.includes('savings_eur'))
  db.exec('ALTER TABLE bkw_daily ADD COLUMN savings_eur REAL');
if (!dailyCols.includes('avg_price_ct'))
  db.exec('ALTER TABLE bkw_daily ADD COLUMN avg_price_ct REAL');

// Anker-Readings: Gesamt-PV-Eingang der Solarbank nachträglich erfassen
const ankerCols = db.prepare('PRAGMA table_info(anker_readings)').all().map(c => c.name);
if (!ankerCols.includes('solar_power'))
  db.exec('ALTER TABLE anker_readings ADD COLUMN solar_power REAL');

// Powerbanks: Entlade-Zeitfenster (z.B. nur 05:00–22:30 entladen)
const pbCols = db.prepare('PRAGMA table_info(powerbanks)').all().map(c => c.name);
if (!pbCols.includes('discharge_start'))
  db.exec("ALTER TABLE powerbanks ADD COLUMN discharge_start TEXT NOT NULL DEFAULT '00:00'");
if (!pbCols.includes('discharge_end'))
  db.exec("ALTER TABLE powerbanks ADD COLUMN discharge_end TEXT NOT NULL DEFAULT '23:59'");

// Seed
if (!db.prepare('SELECT id FROM users WHERE username = ?').get('admin')) {
  db.prepare('INSERT INTO users (username, password, email, is_admin) VALUES (?,?,?,1)')
    .run('admin', bcrypt.hashSync('admin', 10), 'bkw@glasknochen.at');
  console.log('[db] Created default admin (admin / admin)');
}

if (db.prepare('SELECT count(*) AS c FROM inverters').get().c === 0) {
  for (const [name, path, color] of [
    ['Erwin',  'opendtu_erwin/',  '#e74c3c'],
    ['Michi',  'opendtu_michi/',  '#3498db'],
    ['Balkon', 'opendtu_balkon/', '#2ecc71'],
  ]) db.prepare('INSERT OR IGNORE INTO inverters (name, api_path, color) VALUES (?,?,?)').run(name, path, color);
}

for (const [k, v, l] of [
  ['api_base_url',   'https://test.glasknochen.at/', 'OpenDTU API Base URL'],
  ['sync_interval',  '1',                            'Sync interval (minutes)'],
  ['auto_refresh_s', '30',                           'Dashboard auto-refresh (s)'],
  ['app_name',       'BKW',                          'Application Name'],
  ['spotty_url',     'https://i.spottyenergie.at/api/prices/CONSUMPTION/1bfac7b4-8406-4f0e-95e2-851e74b89e10', 'Spotty Energie API URL'],
  ['tz_offset_h',    '1',                            'Local UTC offset (hours, e.g. 1 for CET, 2 for CEST)'],
  ['timezone',       'Europe/Vienna',                'IANA Timezone (für Sommer-/Winterzeit)'],
  ['price_mode',     'fixed',                        'Tariff mode: spotty or fixed'],
  ['fixed_price_ct', '30',                           'Fixed tariff (ct/kWh)'],
  ['mwst_percent',   '20',                           'MwSt (%)'],
  ['netzgebuehr_ct', '0',                            'Netzgebühr (ct/kWh)'],
  ['shelly_url',     '',                             'Shelly Pro 3EM URL (z.B. http://192.168.1.50)'],
]) db.prepare('INSERT OR IGNORE INTO app_settings (key, value, label) VALUES (?,?,?)').run(k, v, l);

// Demo history
if (db.prepare('SELECT count(*) AS c FROM bkw_history').get().c === 0) {
  const ins = db.prepare(`
    INSERT INTO bkw_history (name, log_time, temperature_v, power_dc_v, current_v,
      power_ac_v, voltage_ac_v, frequency_v, power_factor, yield_day, yield_total)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `);
  const names = ['Erwin','Michi','Balkon'];
  const base  = { Erwin: 2000, Michi: 1500, Balkon: 400 };
  const now   = new Date();
  const rows  = [];
  for (let day = 6; day >= 0; day--) {
    for (let h = 0; h < 24; h++) {
      const dt = new Date(now); dt.setDate(dt.getDate() - day); dt.setHours(h,0,0,0);
      const t  = dt.toISOString().replace('T',' ').substring(0,19);
      const sf = (h>=7&&h<=19) ? Math.sin(((h-7)/12)*Math.PI) : 0;
      for (const n of names) {
        const noise = () => (Math.random()-.5)*.1;
        const pw = parseFloat((base[n]*sf*(1+noise())).toFixed(1));
        rows.push([n,t, parseFloat((25+sf*15+noise()*3).toFixed(1)),
          pw, parseFloat((pw/230).toFixed(2)), pw*.97, 230+noise()*5,
          50+noise()*.5, .99, parseFloat((pw*.001).toFixed(3)),
          parseFloat((12500+Math.random()*100).toFixed(1))]);
      }
    }
  }
  db.exec('BEGIN');
  for (const r of rows) ins.run(...r);
  db.exec('COMMIT');
  console.log(`[db] Seeded ${rows.length} demo history rows`);
}

export default db;
