import db from '$lib/db.js';
import { getTzOffset, getLocalToday } from '$lib/tz.js';

function getSetting(key) {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
}

function dayUtcRange(localDate, tzHours) {
  const startD = new Date(`${localDate}T00:00:00Z`);
  startD.setUTCHours(startD.getUTCHours() - tzHours);
  const endD = new Date(startD.getTime() + 24 * 3_600_000);
  const fmt = d => d.toISOString().replace('T', ' ').substring(0, 19);
  return { startUtc: fmt(startD), endUtc: fmt(endD) };
}

function utcToLocalDate(utcStr, tzHours) {
  if (!utcStr) return null;
  const d = new Date(utcStr.replace(' ', 'T') + 'Z');
  d.setUTCHours(d.getUTCHours() + tzHours);
  return d.toISOString().substring(0, 10);
}

/** Build a price-per-15min array aligned with the given history rows + compute day cost in EUR. */
function buildPrices(history, inv, startUtc, endUtc) {
  const globalMode  = getSetting('price_mode') || 'fixed';
  const globalFixed = parseFloat(getSetting('fixed_price_ct') ?? '30');
  const netzCt      = parseFloat(getSetting('netzgebuehr_ct')  ?? '0');
  const mwstPct     = parseFloat(getSetting('mwst_percent')    ?? '0');

  const effectiveMode  = inv.price_mode  ?? globalMode;
  const effectiveFixed = inv.fixed_price_ct ?? globalFixed;

  let priceMap = {};
  if (effectiveMode === 'spotty' && history.length) {
    // spotty_prices uses ISO Z-format ts ("2026-03-17T08:00:00Z")
    const startT = startUtc.replace(' ', 'T') + 'Z';
    const endT   = endUtc.replace(' ', 'T')   + 'Z';
    const rows = db.prepare(
      'SELECT ts, price FROM spotty_prices WHERE ts >= ? AND ts < ? ORDER BY ts'
    ).all(startT, endT);
    for (const r of rows) priceMap[r.ts] = r.price;
  }

  let costEur = 0;
  const prices = history.map(r => {
    const base = effectiveMode === 'fixed' ? effectiveFixed : (priceMap[r.ts] ?? null);
    if (base == null) return null;
    const totalCt = (base + netzCt) * (1 + mwstPct / 100);
    // Accumulate cost: power_W * 0.25h (15-min bucket) / 1000kW * price_ct/100 → EUR
    if (r.total_act_power > 0) costEur += r.total_act_power * 0.25 / 1000 * totalCt / 100;
    return Math.round(totalCt * 10) / 10;
  });

  return { prices, costToday: costEur > 0 ? Math.round(costEur * 1000) / 1000 : null };
}

const t = (label, start) => {
  const ms = Date.now() - start;
  console.log(`[verbrauch] ${label}: ${ms}ms`);
  return Date.now();
};

export async function load({ url }) {
  const T0 = Date.now();
  console.log('[verbrauch] --- load START ---');

  const today   = getLocalToday();
  const tzHours = getTzOffset(today);
  const syncMin = parseInt(getSetting('sync_interval') ?? '1');
  let ts = t('init', T0);

  // Alle Inverter mit Shelly (für Dropdown + Preisinfos)
  const shellInverters = db.prepare(
    "SELECT id, name, color, shelly_url, shelly_feedin_phase, price_mode, fixed_price_ct FROM inverters WHERE enabled=1 AND shelly_url IS NOT NULL AND shelly_url != '' ORDER BY name"
  ).all();
  ts = t('shellInverters query', ts);

  if (!shellInverters.length) {
    console.log('[verbrauch] no shelly inverters configured');
    return { shellInverters: [], selInv: null, byInverter: {}, today, selDate: today, minDate: today };
  }

  const selInvName = url.searchParams.get('inv') ?? shellInverters[0].name;
  const inv = shellInverters.find(i => i.name === selInvName) ?? shellInverters[0];

  let selDate = url.searchParams.get('date') ?? today;
  if (selDate > today) selDate = today;

  let minDate;
  if (selDate < today) {
    const minRow = db.prepare(
      'SELECT MIN(created_at) AS ts FROM shelly_readings WHERE inverter_name = ?'
    ).get(inv.name);
    ts = t('minDate query', ts);
    minDate = minRow?.ts ? (utcToLocalDate(minRow.ts, tzHours) ?? today) : today;
  } else {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 90);
    minDate = d.toISOString().substring(0, 10);
  }
  if (selDate < minDate) selDate = minDate;

  const { startUtc, endUtc } = dayUtcRange(selDate, tzHours);
  const fp = inv.shelly_feedin_phase ?? 'b';
  console.log(`[verbrauch] inv=${inv.name} date=${selDate} range=${startUtc} → ${endUtc}`);

  // Letzter Messwert (nur heute)
  const latest = selDate === today ? (db.prepare(`
    SELECT total_act_power,
           CASE WHEN ? = 'a' THEN a_act_power ELSE ABS(a_act_power) END AS a_act_power,
           CASE WHEN ? = 'b' THEN b_act_power ELSE ABS(b_act_power) END AS b_act_power,
           CASE WHEN ? = 'c' THEN c_act_power ELSE ABS(c_act_power) END AS c_act_power,
           a_voltage, b_voltage, c_voltage,
           strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS ts
    FROM shelly_readings WHERE inverter_name = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(fp, fp, fp, inv.name) ?? null) : null;
  ts = t('latest query', ts);

  // 15-min-Durchschnitt
  const history = db.prepare(`
    SELECT
      strftime('%Y-%m-%dT%H:', created_at) ||
        printf('%02d', (cast(strftime('%M', created_at) AS int) / 15) * 15) || ':00Z' AS ts,
      ROUND(AVG(total_act_power), 1) AS total_act_power,
      ROUND(AVG(CASE WHEN ? = 'a' THEN a_act_power ELSE ABS(a_act_power) END), 1) AS a_act_power,
      ROUND(AVG(CASE WHEN ? = 'b' THEN b_act_power ELSE ABS(b_act_power) END), 1) AS b_act_power,
      ROUND(AVG(CASE WHEN ? = 'c' THEN c_act_power ELSE ABS(c_act_power) END), 1) AS c_act_power
    FROM shelly_readings
    WHERE inverter_name = ? AND created_at >= ? AND created_at < ?
    GROUP BY strftime('%Y-%m-%dT%H', created_at),
             cast(strftime('%M', created_at) AS int) / 15
    ORDER BY ts ASC
  `).all(fp, fp, fp, inv.name, startUtc, endUtc);
  ts = t(`history query (${history.length} rows)`, ts);

  // Tagesverbrauch
  const consumptionToday = db.prepare(`
    SELECT ROUND(SUM(CASE WHEN total_act_power > 0 THEN total_act_power ELSE 0 END) * ? / 60.0, 1) AS wh
    FROM shelly_readings
    WHERE inverter_name = ? AND created_at >= ? AND created_at < ?
  `).get(syncMin, inv.name, startUtc, endUtc)?.wh ?? null;

  // Preise (aligned mit history) + Tageskosten
  const { prices, costToday } = buildPrices(history, inv, startUtc, endUtc);
  t('prices + consumptionToday', ts);

  console.log(`[verbrauch] --- load DONE ${Date.now() - T0}ms total ---`);

  return {
    shellInverters,
    selInv: inv,
    byInverter: { [inv.name]: { ...inv, latest, history, consumptionToday, prices, costToday } },
    today, selDate, minDate,
  };
}
