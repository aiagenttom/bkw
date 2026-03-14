import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import db from './db.js';
import { getTzOffset, getLocalToday, getTimezone } from './tz.js';
import { getAnkerApi } from './anker-api.js';

function getSetting(key) {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
}

/**
 * Build the fetch URL for an inverter.
 * If a serial is set, appends ?inv=<serial> to the base URL.
 */
function buildUrl(url, serial) {
  if (!url?.trim()) return null;
  const base = url.trim().replace(/\/$/, '');
  return serial ? `${base}?inv=${serial}` : base;
}

function parseInverterData(inv) {
  const ac   = inv.AC?.['0']  || {};
  const iv   = inv.INV?.['0'] || {};
  // Sum across all MPPT strings for total DC current; use first string voltage as representative
  const dcKeys = Object.keys(inv.DC || {});
  const dc0    = inv.DC?.['0'] || {};
  const totalDcCurrent = dcKeys.reduce((s, k) => s + (inv.DC[k].Current?.v ?? 0), 0) || null;

  // Per-MPPT-string breakdown (e.g. "Wand", "Villa")
  const dcStrings = dcKeys.map(k => {
    const dc = inv.DC[k];
    return {
      name:    dc.name?.u ?? `String ${k}`,
      power:   dc.Power?.v   ?? null,
      voltage: dc.Voltage?.v ?? null,
      current: dc.Current?.v ?? null,
    };
  }).filter(s => s.power != null || s.current != null);

  return {
    serial:         inv.serial ?? null,
    name:           inv.name   ?? null,
    power_ac:       ac.Power?.v          ?? null,
    current_ac:     ac.Current?.v        ?? null,
    voltage_ac:     ac.Voltage?.v        ?? null,
    frequency:      ac.Frequency?.v      ?? null,
    power_factor:   ac.PowerFactor?.v    ?? null,
    reactive_power: ac.ReactivePower?.v  ?? null,
    // INV['0'] holds the inverter-level totals — use these, not individual MPPT strings
    power_dc:       iv['Power DC']?.v    ?? null,
    current_dc:     totalDcCurrent,
    voltage_dc:     dc0.Voltage?.v       ?? null,
    yield_day:      iv.YieldDay?.v       ?? null,
    yield_total:    iv.YieldTotal?.v     ?? null,
    temperature:    iv.Temperature?.v    ?? null,
    efficiency:     iv.Efficiency?.v     ?? null,
    producing:      inv.producing ? 1 : 0,
    reachable:      inv.reachable ? 1 : 0,
    dc_strings:     dcStrings.length > 1 ? dcStrings : null,
  };
}

async function fetchInverterJson(url) {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    console.warn(`[sync] fetch ${url}: ${err.message}`);
    return null;
  }
}

/**
 * Sync one inverter using a single OpenDTU URL + inverter serial.
 * The serial is appended as ?inv=<serial> so OpenDTU returns only that inverter.
 * The same URL is used for both live card data and bkw_history.
 *
 * @param {string} inverterName  - Name as stored in the inverters table
 * @param {string} url           - OpenDTU livedata API URL (without query params)
 * @param {string|null} serial   - Inverter serial number (optional but recommended)
 */
export async function syncInverter(inverterName, url, serial) {
  const safeId = inverterName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const table  = `sync_live_dtu_${safeId}`;

  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
    id INTEGER PRIMARY KEY AUTOINCREMENT, synced_at TEXT DEFAULT (datetime('now')),
    serial TEXT, name TEXT, power_ac REAL, current_ac REAL, voltage_ac REAL,
    frequency REAL, power_factor REAL, reactive_power REAL,
    power_dc REAL, current_dc REAL, voltage_dc REAL,
    yield_day REAL, yield_total REAL, temperature REAL, efficiency REAL,
    producing INTEGER, reachable INTEGER
  )`);

  const fetchUrl = buildUrl(url, serial);
  if (!fetchUrl) {
    console.warn(`[sync] ${inverterName}: no URL configured, skipping`);
    return null;
  }
  console.log(`[sync] ${inverterName} → ${fetchUrl}`);
  const dataJson = await fetchInverterJson(fetchUrl);
  if (!dataJson) return null;

  const dataInverters = dataJson.inverters ?? (Array.isArray(dataJson) ? dataJson : [dataJson]);
  if (!dataInverters.length) return null;

  // Select the correct inverter from the response:
  // 1. Match by serial (most precise)
  // 2. Match by name (case-insensitive fallback)
  // 3. Fall back to first entry
  let invData = dataInverters[0];
  if (serial) {
    invData = dataInverters.find(d => String(d.serial) === String(serial)) ?? invData;
  } else {
    invData = dataInverters.find(d =>
      (d.name ?? '').toLowerCase() === inverterName.toLowerCase()
    ) ?? invData;
  }

  const p = parseInverterData(invData);
  const now = new Date().toISOString().replace('T',' ').substring(0,19);

  db.exec('BEGIN');
  db.prepare(`INSERT INTO ${table}
    (synced_at, serial, name, power_ac, current_ac, voltage_ac, frequency,
     power_factor, reactive_power, power_dc, current_dc, voltage_dc,
     yield_day, yield_total, temperature, efficiency, producing, reachable)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      now, p.serial, p.name, p.power_ac, p.current_ac, p.voltage_ac,
      p.frequency, p.power_factor, p.reactive_power, p.power_dc,
      p.current_dc, p.voltage_dc, p.yield_day, p.yield_total,
      p.temperature, p.efficiency, p.producing, p.reachable);
  db.prepare(`DELETE FROM ${table} WHERE id NOT IN
    (SELECT id FROM ${table} ORDER BY synced_at DESC LIMIT 60)`).run();
  db.prepare(`INSERT INTO bkw_history
    (name, log_time, temperature_v, power_dc_v, current_v,
     power_ac_v, voltage_ac_v, frequency_v, power_factor, yield_day, yield_total, dc_strings)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      inverterName, now, p.temperature, p.power_dc, p.current_dc,
      p.power_ac, p.voltage_ac, p.frequency, p.power_factor, p.yield_day, p.yield_total,
      p.dc_strings ? JSON.stringify(p.dc_strings) : null);
  db.exec('COMMIT');

  console.log(`[sync] ${inverterName}: ${p.power_ac}W AC`);
  return p;
}

export async function syncAll() {
  const inverters = db.prepare('SELECT * FROM inverters WHERE enabled = 1').all();

  const { lastInsertRowid: logId } = db.prepare(
    `INSERT INTO automation_log (automation_name, started_at, status) VALUES ('SyncAll', datetime('now'), 'RUNNING')`
  ).run();

  let ok = 0, err = 0;
  for (const inv of inverters) {
    try {
      const r = await syncInverter(inv.name, inv.full_url, inv.serial);
      if (r) {
        ok++;
        db.prepare(`INSERT INTO automation_msg_log (log_id, message, message_type, pk_value) VALUES (?,?,'INFO',?)`)
          .run(logId, `Synced ${inv.name}: ${r.power_ac ?? '?'} W AC`, inv.name);
      } else {
        err++;
        db.prepare(`INSERT INTO automation_msg_log (log_id, message, message_type, pk_value) VALUES (?,?,'WARNING',?)`)
          .run(logId, `No data for ${inv.name}`, inv.name);
      }
    } catch (e) {
      err++;
      db.prepare(`INSERT INTO automation_msg_log (log_id, message, message_type, pk_value) VALUES (?,?,'ERROR',?)`)
        .run(logId, `Error syncing ${inv.name}: ${e.message}`, inv.name);
    }
  }

  db.prepare(`UPDATE automation_log SET ended_at=datetime('now'), status=?, successful_rows=?, error_rows=? WHERE id=?`)
    .run(err > 0 ? 'ERROR' : 'SUCCESS', ok, err, logId);
}

/**
 * Fetch current + upcoming 15-min spot prices from Spotty Energie API
 * and store them in the spotty_prices table.
 */
export async function syncSpottyPrices() {
  const url = getSetting('spotty_url');
  if (!url) { console.warn('[spotty] no spotty_url configured'); return; }

  let data;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    data = await resp.json();
  } catch (e) {
    console.warn(`[spotty] fetch failed: ${e.message}`);
    return;
  }

  if (!Array.isArray(data) || !data.length) {
    console.warn('[spotty] unexpected response shape');
    return;
  }

  const ins = db.prepare('INSERT OR IGNORE INTO spotty_prices (ts, price) VALUES (?, ?)');
  db.exec('BEGIN');
  let count = 0;
  for (const { from, price } of data) {
    if (from && price != null) { ins.run(from, price); count++; }
  }
  db.exec('COMMIT');

  const total = db.prepare('SELECT COUNT(*) AS c FROM spotty_prices').get().c;
  const oldest = db.prepare('SELECT MIN(ts) AS t FROM spotty_prices').get().t;
  console.log(`[spotty] +${count} new slots | total: ${total} | oldest: ${oldest ?? '–'}`);
}

/**
 * Remove spot prices older than 13 months to keep the DB tidy.
 * Runs once daily — preserves enough history for year-over-year comparison.
 */
export function pruneSpottyPrices() {
  const { changes } = db.prepare(
    `DELETE FROM spotty_prices WHERE ts < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-13 months')`
  ).run();
  if (changes > 0) console.log(`[spotty] pruned ${changes} old price slots (>13 months)`);
}

/**
 * Snapshot daily totals per inverter from bkw_history.
 * Calculates savings_eur based on tariff mode (spotty or fixed).
 * INSERT OR REPLACE → safe to call multiple times per day.
 * @param {string} [date] - ISO date YYYY-MM-DD, defaults to today
 */
export function syncDaily(date) {
  const target = date || getLocalToday();
  const tzOffset = getTzOffset(target);

  const rows = db.prepare(`
    SELECT
      name                         AS inverter,
      MAX(yield_day)               AS yield_wh,
      ROUND(MAX(power_ac_v), 1)    AS peak_w,
      ROUND(AVG(CASE WHEN power_ac_v > 0 THEN power_ac_v END), 1) AS avg_w,
      ROUND(MIN(temperature_v), 1) AS min_temp,
      ROUND(MAX(temperature_v), 1) AS max_temp,
      COUNT(*)                     AS readings
    FROM bkw_history
    WHERE date(datetime(log_time, '+' || ? || ' hours')) = ?
    GROUP BY name
  `).all(tzOffset, target);

  if (!rows.length) {
    console.log(`[daily] no data for ${target}`);
    return [];
  }

  // ── Savings calculation ────────────────────────────────────────────────────
  // Global defaults (used when inverter has no per-inverter override)
  const globalMode    = getSetting('price_mode') || 'fixed';
  const globalFixedCt = parseFloat(getSetting('fixed_price_ct') || '30');
  const mwstPct       = parseFloat(getSetting('mwst_percent') || '0');
  const netzCt        = parseFloat(getSetting('netzgebuehr_ct') || '0');

  // Load per-inverter settings: { name → { price_mode, fixed_price_ct } }
  const invSettings = Object.fromEntries(
    db.prepare('SELECT name, price_mode, fixed_price_ct FROM inverters').all()
      .map(i => [i.name, i])
  );

  // Determine which inverters need spotty pricing
  const spottyInverters = rows
    .map(r => r.inverter)
    .filter(name => (invSettings[name]?.price_mode ?? globalMode) === 'spotty');

  // Spotty weighted avg price per inverter (only for those that need it)
  const spottyAvgMap = {};
  if (spottyInverters.length > 0) {
    const placeholders = spottyInverters.map(() => '?').join(',');
    const spotRows = db.prepare(`
      SELECT
        h.name AS inverter,
        ROUND(SUM(h.power_ac_v * sp.price) / NULLIF(SUM(h.power_ac_v), 0), 3) AS avg_price_ct
      FROM bkw_history h
      JOIN spotty_prices sp
        ON sp.ts = (
          strftime('%Y-%m-%dT%H:', datetime(h.log_time, '-' || ? || ' hours')) ||
          printf('%02d:00Z',
            (CAST(strftime('%M', datetime(h.log_time, '-' || ? || ' hours')) AS INTEGER) / 15) * 15
          )
        )
      WHERE date(datetime(h.log_time, '+' || ? || ' hours')) = ?
        AND h.power_ac_v > 0
        AND h.name IN (${placeholders})
      GROUP BY h.name
    `).all(tzOffset, tzOffset, tzOffset, target, ...spottyInverters);

    for (const { inverter, avg_price_ct } of spotRows) {
      spottyAvgMap[inverter] = avg_price_ct;
    }
  }

  for (const r of rows) {
    const inv      = invSettings[r.inverter] ?? {};
    const mode     = inv.price_mode ?? globalMode;
    const fixedCt  = inv.fixed_price_ct ?? globalFixedCt;

    if (mode === 'fixed') {
      r.avg_price_ct = fixedCt;
    } else {
      r.avg_price_ct = spottyAvgMap[r.inverter] ?? null;
    }
    const totalCtPerKwh = r.avg_price_ct != null ? (r.avg_price_ct + netzCt) * (1 + mwstPct / 100) : null;
    r.savings_eur = totalCtPerKwh != null && r.yield_wh != null
      ? parseFloat((r.yield_wh / 1000 * totalCtPerKwh / 100).toFixed(4))
      : null;
  }

  const insert = db.prepare(`
    INSERT OR REPLACE INTO bkw_daily
      (date, inverter, yield_wh, peak_w, avg_w, min_temp, max_temp, readings, savings_eur, avg_price_ct)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  for (const r of rows) {
    insert.run(target, r.inverter, r.yield_wh, r.peak_w, r.avg_w,
               r.min_temp, r.max_temp, r.readings, r.savings_eur ?? null, r.avg_price_ct ?? null);
  }
  db.exec('COMMIT');

  console.log(`[daily] snapshotted ${rows.length} inverters for ${target} (mode=${globalMode})`);
  return rows;
}

/**
 * Fetch 7-day weather forecast from Open-Meteo and persist to weather_hourly / weather_daily.
 * Uses INSERT OR REPLACE so re-running is safe and updates stale forecasts.
 */
export async function syncWeather() {
  const tz = getTimezone();
  const url = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=48.08&longitude=16.28'
    + '&hourly=shortwave_radiation,direct_radiation,cloud_cover,temperature_2m,windspeed_10m'
    + '&daily=sunshine_duration,shortwave_radiation_sum,temperature_2m_max,temperature_2m_min'
    + '&forecast_days=7'
    + '&timezone=' + encodeURIComponent(tz);

  let data;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    data = await resp.json();
  } catch (e) {
    console.warn(`[weather] fetch failed: ${e.message}`);
    return;
  }

  const insHourly = db.prepare(`
    INSERT OR REPLACE INTO weather_hourly (date, hour, ghi, direct_radiation, cloud_cover, temperature, wind_speed)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insDaily = db.prepare(`
    INSERT OR REPLACE INTO weather_daily (date, sunshine_duration_h, radiation_sum, temp_max, temp_min)
    VALUES (?, ?, ?, ?, ?)
  `);

  let hourlyCount = 0;
  db.transaction(() => {
    if (data.hourly?.time) {
      for (let i = 0; i < data.hourly.time.length; i++) {
        const dt   = data.hourly.time[i]; // e.g. "2026-03-07T14:00"
        const date = dt.substring(0, 10);
        const hour = parseInt(dt.substring(11, 13));
        insHourly.run(
          date, hour,
          data.hourly.shortwave_radiation?.[i]  ?? null,
          data.hourly.direct_radiation?.[i]     ?? null,
          data.hourly.cloud_cover?.[i]          ?? null,
          data.hourly.temperature_2m?.[i]       ?? null,
          data.hourly.windspeed_10m?.[i]        ?? null,
        );
        hourlyCount++;
      }
    }
    if (data.daily?.time) {
      for (let i = 0; i < data.daily.time.length; i++) {
        const date = data.daily.time[i];
        insDaily.run(
          date,
          Math.round((data.daily.sunshine_duration?.[i] ?? 0) / 3600 * 10) / 10,
          data.daily.shortwave_radiation_sum?.[i]  ?? null,
          data.daily.temperature_2m_max?.[i]       ?? null,
          data.daily.temperature_2m_min?.[i]       ?? null,
        );
      }
    }
  })();

  console.log(`[weather] synced ${hourlyCount} hourly slots (7-day forecast)`);
}

/**
 * Fetch Anker SOLIX live data and persist to anker_readings.
 * Called by the background cron every 5 minutes – not from the browser.
 */
export async function syncAnker() {
  const configPath = join(homedir(), '.bkw-data', 'anker-service.json');
  let config;
  try {
    if (!existsSync(configPath)) return null;
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch { return null; }

  if (!config?.enabled || !config.email || !config.password) return null;

  try {
    const api    = getAnkerApi(config.email, config.password, config.country || 'de');
    const status = await api.getDeviceStatus(config.device_sn || null);

    db.prepare(`
      INSERT INTO anker_readings (device_sn, soc, charge_w, discharge_w, solar_power, state)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(status.device_sn, status.soc, status.charge_w, status.discharge_w,
           status.solar_power ?? null, status.state);

    // ── Lifetime-Statistiken in app_settings persistieren ──────────────────
    // Werden von der Anker-Cloud geliefert und sind kumulativ (wachsen über Zeit).
    const settingsUpsert = db.prepare(
      `INSERT OR REPLACE INTO app_settings (key, value, label) VALUES (?, ?, ?)`
    );
    if (status.lifetime_kwh != null)
      settingsUpsert.run('anker_lifetime_kwh', String(status.lifetime_kwh), 'Anker Lifetime Energie (kWh)');
    if (status.lifetime_co2 != null)
      settingsUpsert.run('anker_lifetime_co2', String(status.lifetime_co2), 'Anker Lifetime CO₂-Einsparung (kg)');
    if (status.lifetime_eur != null)
      settingsUpsert.run('anker_lifetime_eur', String(status.lifetime_eur), 'Anker Lifetime Geldersparnis (€)');
    if (status.retain_load_w != null)
      settingsUpsert.run('anker_retain_load_w', String(status.retain_load_w), 'Anker konfigurierte Ausgabeleistung (W)');

    console.log(`[anker] SOC ${status.soc}% ↑${status.charge_w}W ↓${status.discharge_w}W` +
      (status.lifetime_kwh != null ? ` | Lifetime ${status.lifetime_kwh} kWh` : ''));
    return status;
  } catch (e) {
    console.warn(`[anker] sync failed: ${e.message}`);
    return null;
  }
}

/**
 * Fetch Shelly Pro 3EM live data and persist to shelly_readings.
 * Uses Shelly Gen2 RPC API:
 *   GET /rpc/EM.GetStatus?id=0    → live power per phase
 *   GET /rpc/EMData.GetStatus?id=0 → cumulative energy (Wh)
 */
export async function syncShelly() {
  const url = getSetting('shelly_url');
  if (!url?.trim()) return;

  const base = url.trim().replace(/\/$/, '');
  let emStatus = null, emData = null;

  try {
    const [r1, r2] = await Promise.allSettled([
      fetch(`${base}/rpc/EM.GetStatus?id=0`,    { signal: AbortSignal.timeout(5000) }),
      fetch(`${base}/rpc/EMData.GetStatus?id=0`, { signal: AbortSignal.timeout(5000) }),
    ]);
    if (r1.status === 'fulfilled' && r1.value.ok) emStatus = await r1.value.json();
    if (r2.status === 'fulfilled' && r2.value.ok) emData   = await r2.value.json();
  } catch (e) {
    console.warn(`[shelly] fetch failed: ${e.message}`);
    return;
  }

  if (!emStatus) { console.warn('[shelly] no EM status returned'); return; }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  db.prepare(`
    INSERT INTO shelly_readings
      (created_at, total_act_power, a_act_power, b_act_power, c_act_power,
       a_voltage, b_voltage, c_voltage, total_energy_wh)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    now,
    emStatus.total_act_power ?? null,
    emStatus.a_act_power     ?? null,
    emStatus.b_act_power     ?? null,
    emStatus.c_act_power     ?? null,
    emStatus.a_voltage       ?? null,
    emStatus.b_voltage       ?? null,
    emStatus.c_voltage       ?? null,
    emData?.total_act        ?? null,
  );

  // Keep last 1440 readings (24h × 1min)
  db.prepare(
    `DELETE FROM shelly_readings WHERE id NOT IN
     (SELECT id FROM shelly_readings ORDER BY created_at DESC LIMIT 1440)`
  ).run();

  console.log(`[shelly] ${emStatus.total_act_power ?? '?'} W (L1:${emStatus.a_act_power ?? '?'} L2:${emStatus.b_act_power ?? '?'} L3:${emStatus.c_act_power ?? '?'})`);
}

/**
 * Verdichtet Anker-Rohdaten und löscht altes Material.
 *
 * Strategie:
 *   • anker_readings (5-min-Rohdaten):  max. 2 Jahre → vorher zu anker_daily verdichten
 *   • anker_daily   (Tages-Aggregate):  dauerhaft erhalten
 *   • bkw_history   (minütliche Daten): max. 2 Jahre → bkw_daily bleibt als Kompakt-Form
 *   • bkw_daily     (Tages-Aggregate):  dauerhaft erhalten
 *
 * Wird nächtlich um 23:55 aufgerufen.
 */
export function pruneOldData() {
  const tzH = parseInt(getSetting('tz_offset_h') ?? '1');

  // ── Schritt 1: Anker-Rohdaten verdichten (INSERT OR REPLACE in anker_daily) ──
  // Aggregiert alle Tage die älter als 2 Jahre sind und noch nicht in anker_daily stehen.
  // INSERT OR REPLACE überschreibt bestehende Tages-Einträge sicher.
  db.prepare(`
    INSERT OR REPLACE INTO anker_daily
      (date, avg_soc, min_soc, max_soc, charge_wh, discharge_wh, readings)
    SELECT
      date(datetime(created_at, '+' || ? || ' hours'))           AS date,
      ROUND(AVG(COALESCE(soc, 0)), 1)                            AS avg_soc,
      ROUND(MIN(COALESCE(soc, 0)), 1)                            AS min_soc,
      ROUND(MAX(COALESCE(soc, 0)), 1)                            AS max_soc,
      ROUND(SUM(COALESCE(charge_w,    0)) * 5 / 60.0, 1)        AS charge_wh,
      ROUND(SUM(COALESCE(discharge_w, 0)) * 5 / 60.0, 1)        AS discharge_wh,
      COUNT(*)                                                    AS readings
    FROM anker_readings
    WHERE created_at < datetime('now', '-2 years')
    GROUP BY date
  `).run(tzH);

  // ── Schritt 2: Veraltete Rohdaten löschen ──────────────────────────────────
  const { changes: ankerChanges } = db.prepare(
    `DELETE FROM anker_readings WHERE created_at < datetime('now', '-2 years')`
  ).run();

  // bkw_history: bkw_daily ist die Kompakt-Form und bleibt dauerhaft erhalten
  const { changes: histChanges } = db.prepare(
    `DELETE FROM bkw_history WHERE log_time < datetime('now', '-2 years')`
  ).run();

  // ── Logging ────────────────────────────────────────────────────────────────
  if (ankerChanges > 0) console.log(`[prune] anker_readings: ${ankerChanges} Rohdaten verdichtet → anker_daily`);
  if (histChanges  > 0) console.log(`[prune] bkw_history:    ${histChanges} Minuten-Daten gelöscht (bkw_daily bleibt)`);
  if (!ankerChanges && !histChanges) console.log('[prune] nichts zu bereinigen (Daten < 2 Jahre)');
}
