import db from './db.js';

function getSetting(key) {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
}

function resolveUrl(baseUrl, apiPath, fullUrl) {
  if (fullUrl?.trim()) return fullUrl.trim();
  const base = (baseUrl || '').replace(/\/$/, '');
  const rel  = (apiPath || '').replace(/^\//, '');
  return rel ? `${base}/${rel}` : base;
}

function parseInverterData(inv) {
  const ac = inv.AC?.['0'] || {};
  const dc = inv.DC?.['0'] || {};
  const iv = inv.INV?.['0'] || {};
  return {
    serial: inv.serial ?? null, name: inv.name ?? null,
    power_ac: ac.Power?.v ?? null,       current_ac: ac.Current?.v ?? null,
    voltage_ac: ac.Voltage?.v ?? null,   frequency: ac.Frequency?.v ?? null,
    power_factor: ac.PowerFactor?.v ?? null, reactive_power: ac.ReactivePower?.v ?? null,
    power_dc: dc.Power?.v ?? null,       current_dc: dc.Current?.v ?? null,
    voltage_dc: dc.Voltage?.v ?? null,   yield_day: dc.YieldDay?.v ?? null,
    yield_total: dc.YieldTotal?.v ?? null, temperature: iv.Temperature?.v ?? null,
    efficiency: inv.efficiency ?? null,  producing: inv.producing ? 1 : 0,
    reachable: inv.reachable ? 1 : 0,
  };
}

export async function syncInverter(inverterName, apiPath, baseUrl, fullUrl) {
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

  const url = resolveUrl(baseUrl, apiPath, fullUrl);
  console.log(`[sync] ${inverterName} → ${url}`);

  let json;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    json = await resp.json();
  } catch (err) {
    console.warn(`[sync] ${inverterName}: ${err.message}`);
    return null;
  }

  const inverters = json.inverters ?? (Array.isArray(json) ? json : [json]);
  if (!inverters.length) return null;

  const p   = parseInverterData(inverters[0]);
  const now = new Date().toISOString().replace('T',' ').substring(0,19);

  db.exec('BEGIN');
  db.prepare(`INSERT INTO ${table}
    (synced_at, serial, name, power_ac, current_ac, voltage_ac, frequency,
     power_factor, reactive_power, power_dc, current_dc, voltage_dc,
     yield_day, yield_total, temperature, efficiency, producing, reachable)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      now, p.serial, p.name, p.power_ac, p.current_ac, p.voltage_ac, p.frequency,
      p.power_factor, p.reactive_power, p.power_dc, p.current_dc, p.voltage_dc,
      p.yield_day, p.yield_total, p.temperature, p.efficiency, p.producing, p.reachable);
  db.prepare(`DELETE FROM ${table} WHERE id NOT IN
    (SELECT id FROM ${table} ORDER BY synced_at DESC LIMIT 60)`).run();
  db.prepare(`INSERT INTO bkw_history
    (name, log_time, temperature_v, power_dc_v, current_v,
     power_ac_v, voltage_ac_v, frequency_v, power_factor, yield_day, yield_total)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      inverterName, now, p.temperature, p.power_dc, p.current_dc,
      p.power_ac, p.voltage_ac, p.frequency, p.power_factor, p.yield_day, p.yield_total);
  db.exec('COMMIT');

  console.log(`[sync] ${inverterName}: ${p.power_ac}W AC`);
  return p;
}

export async function syncAll() {
  const baseUrl   = getSetting('api_base_url') || 'https://test.glasknochen.at/';
  const inverters = db.prepare('SELECT * FROM inverters WHERE enabled = 1').all();

  const { lastInsertRowid: logId } = db.prepare(
    `INSERT INTO automation_log (automation_name, started_at, status) VALUES ('SyncAll', datetime('now'), 'RUNNING')`
  ).run();

  let ok = 0, err = 0;
  for (const inv of inverters) {
    try {
      const r = await syncInverter(inv.name, inv.api_path, baseUrl, inv.full_url);
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
  console.log(`[spotty] stored ${count} price slots`);
}

/**
 * Snapshot daily totals per inverter from bkw_history.
 * Calculates savings_eur based on tariff mode (spotty or fixed).
 * INSERT OR REPLACE → safe to call multiple times per day.
 * @param {string} [date] - ISO date YYYY-MM-DD, defaults to today
 */
export function syncDaily(date) {
  const target = date || new Date().toISOString().substring(0, 10);

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
    WHERE date(log_time) = ?
    GROUP BY name
  `).all(target);

  if (!rows.length) {
    console.log(`[daily] no data for ${target}`);
    return [];
  }

  // ── Savings calculation ────────────────────────────────────────────────────
  // Global defaults (used when inverter has no per-inverter override)
  const globalMode    = getSetting('price_mode') || 'fixed';
  const globalFixedCt = parseFloat(getSetting('fixed_price_ct') || '30');
  const tzOffset      = parseInt(getSetting('tz_offset_h') || '1');

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
      WHERE date(h.log_time) = ?
        AND h.power_ac_v > 0
        AND h.name IN (${placeholders})
      GROUP BY h.name
    `).all(tzOffset, tzOffset, target, ...spottyInverters);

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
    r.savings_eur = r.avg_price_ct != null && r.yield_wh != null
      ? parseFloat((r.yield_wh / 1000 * r.avg_price_ct / 100).toFixed(4))
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
