import { json } from '@sveltejs/kit';
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

/** Build prices array aligned with history rows + compute day cost in EUR. */
function buildPrices(history, inv, startUtc, endUtc) {
  const globalMode  = getSetting('price_mode') || 'fixed';
  const globalFixed = parseFloat(getSetting('fixed_price_ct') ?? '30');
  const netzCt      = parseFloat(getSetting('netzgebuehr_ct')  ?? '0');
  const mwstPct     = parseFloat(getSetting('mwst_percent')    ?? '0');

  const effectiveMode  = inv.price_mode  ?? globalMode;
  const effectiveFixed = inv.fixed_price_ct ?? globalFixed;

  let priceMap = {};
  if (effectiveMode === 'spotty' && history.length) {
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

export function GET({ url }) {
  const today   = getLocalToday();
  const tzHours = getTzOffset(today);
  const syncMin = parseInt(getSetting('sync_interval') ?? '1');
  const { startUtc, endUtc } = dayUtcRange(today, tzHours);

  const invParam = url.searchParams.get('inv');

  const shellInverters = db.prepare(
    "SELECT id, name, color, shelly_url, shelly_feedin_phase, price_mode, fixed_price_ct FROM inverters WHERE enabled=1 AND shelly_url IS NOT NULL AND shelly_url != '' ORDER BY name"
  ).all();

  // Nur den angefragten Inverter laden (Performance)
  const toLoad = invParam ? shellInverters.filter(i => i.name === invParam) : shellInverters;

  const byInverter = {};
  for (const inv of toLoad) {
    const fp = inv.shelly_feedin_phase ?? 'b';

    const latest = db.prepare(`
      SELECT total_act_power,
             CASE WHEN ? = 'a' THEN a_act_power ELSE ABS(a_act_power) END AS a_act_power,
             CASE WHEN ? = 'b' THEN b_act_power ELSE ABS(b_act_power) END AS b_act_power,
             CASE WHEN ? = 'c' THEN c_act_power ELSE ABS(c_act_power) END AS c_act_power,
             a_voltage, b_voltage, c_voltage,
             strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS ts
      FROM shelly_readings
      WHERE inverter_name = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(fp, fp, fp, inv.name) ?? null;

    // UTC-Range für heute → Index (inverter_name, created_at) wird genutzt
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

    const consumptionToday = db.prepare(`
      SELECT ROUND(SUM(CASE WHEN total_act_power > 0 THEN total_act_power ELSE 0 END) * ? / 60.0, 1) AS wh
      FROM shelly_readings
      WHERE inverter_name = ? AND created_at >= ? AND created_at < ?
    `).get(syncMin, inv.name, startUtc, endUtc)?.wh ?? null;

    const { prices, costToday } = buildPrices(history, inv, startUtc, endUtc);

    byInverter[inv.name] = { ...inv, latest, history, consumptionToday, prices, costToday };
  }

  return json({ success: true, shellInverters, byInverter });
}
