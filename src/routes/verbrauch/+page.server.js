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

export async function load({ url }) {
  const today   = getLocalToday();
  const tzHours = getTzOffset(today);
  const syncMin = parseInt(getSetting('sync_interval') ?? '1');

  // Alle Inverter mit Shelly (nur für Dropdown, kein Data-Load)
  const shellInverters = db.prepare(
    "SELECT id, name, color, shelly_url, shelly_feedin_phase FROM inverters WHERE enabled=1 AND shelly_url IS NOT NULL AND shelly_url != '' ORDER BY name"
  ).all();

  if (!shellInverters.length) {
    return { shellInverters: [], selInv: null, byInverter: {}, today, selDate: today, minDate: today };
  }

  // Inverter aus URL-Parameter, default: erster
  const selInvName = url.searchParams.get('inv') ?? shellInverters[0].name;
  const inv = shellInverters.find(i => i.name === selInvName) ?? shellInverters[0];

  // Datum aus URL-Parameter, default: heute
  let selDate = url.searchParams.get('date') ?? today;
  if (selDate > today) selDate = today;

  // minDate: nur bei historischer Navigation wirklich aus DB lesen,
  // beim initialen Load (heute) reicht ein 90-Tage-Fallback
  let minDate;
  if (selDate < today) {
    const minRow = db.prepare(
      'SELECT MIN(created_at) AS ts FROM shelly_readings WHERE inverter_name = ?'
    ).get(inv.name);
    minDate = minRow?.ts ? (utcToLocalDate(minRow.ts, tzHours) ?? today) : today;
  } else {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 90);
    minDate = d.toISOString().substring(0, 10);
  }
  if (selDate < minDate) selDate = minDate;

  const { startUtc, endUtc } = dayUtcRange(selDate, tzHours);
  const fp = inv.shelly_feedin_phase ?? 'b';

  // Letzter Messwert (nur für heute)
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

  // 15-min-Durchschnitt für gewählten Tag
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

  return {
    shellInverters,
    selInv: inv,
    byInverter: { [inv.name]: { ...inv, latest, history, consumptionToday } },
    today, selDate, minDate,
  };
}
