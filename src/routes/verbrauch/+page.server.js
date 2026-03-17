import db from '$lib/db.js';
import { getTzOffset, getLocalToday } from '$lib/tz.js';

function getSetting(key) {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
}

export async function load({ url }) {
  const today   = getLocalToday();
  const tzHours = getTzOffset(today);
  const syncMin = parseInt(getSetting('sync_interval') ?? '1');

  // Datum aus URL-Parameter, default: heute
  let selDate = url.searchParams.get('date') ?? today;
  if (selDate > today) selDate = today;

  // Frühestes Datum mit Shelly-Daten
  const minRow = db.prepare(
    `SELECT MIN(date(datetime(created_at, '+' || ? || ' hours'))) AS d FROM shelly_readings`
  ).get(tzHours);
  const minDate = minRow?.d ?? today;
  if (selDate < minDate) selDate = minDate;

  // Alle Inverter mit konfigurierter Shelly-URL
  const shellInverters = db.prepare(
    "SELECT id, name, color, shelly_url, shelly_feedin_phase FROM inverters WHERE enabled=1 AND shelly_url IS NOT NULL AND shelly_url != '' ORDER BY name"
  ).all();

  const byInverter = {};
  for (const inv of shellInverters) {
    const fp = inv.shelly_feedin_phase ?? 'b';

    // Letzter Messwert (nur für heute relevant)
    const latest = selDate === today ? (db.prepare(`
      SELECT total_act_power,
             CASE WHEN ? = 'a' THEN a_act_power ELSE ABS(a_act_power) END AS a_act_power,
             CASE WHEN ? = 'b' THEN b_act_power ELSE ABS(b_act_power) END AS b_act_power,
             CASE WHEN ? = 'c' THEN c_act_power ELSE ABS(c_act_power) END AS c_act_power,
             a_voltage, b_voltage, c_voltage,
             strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS ts
      FROM shelly_readings
      WHERE inverter_name = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(fp, fp, fp, inv.name) ?? null) : null;

    // 15-min-Durchschnitt für den gewählten Tag
    const history = db.prepare(`
      SELECT
        strftime('%Y-%m-%dT%H:', created_at) ||
          printf('%02d', (cast(strftime('%M', created_at) AS int) / 15) * 15) || ':00Z' AS ts,
        ROUND(AVG(total_act_power), 1) AS total_act_power,
        ROUND(AVG(CASE WHEN ? = 'a' THEN a_act_power ELSE ABS(a_act_power) END), 1) AS a_act_power,
        ROUND(AVG(CASE WHEN ? = 'b' THEN b_act_power ELSE ABS(b_act_power) END), 1) AS b_act_power,
        ROUND(AVG(CASE WHEN ? = 'c' THEN c_act_power ELSE ABS(c_act_power) END), 1) AS c_act_power
      FROM shelly_readings
      WHERE inverter_name = ?
        AND date(datetime(created_at, '+' || ? || ' hours')) = ?
      GROUP BY strftime('%Y-%m-%dT%H', created_at),
               cast(strftime('%M', created_at) AS int) / 15
      ORDER BY ts ASC
    `).all(fp, fp, fp, inv.name, tzHours, selDate);

    const consumptionToday = db.prepare(`
      SELECT ROUND(SUM(CASE WHEN total_act_power > 0 THEN total_act_power ELSE 0 END) * ? / 60.0, 1) AS wh
      FROM shelly_readings
      WHERE inverter_name = ?
        AND date(datetime(created_at, '+' || ? || ' hours')) = ?
    `).get(syncMin, inv.name, tzHours, selDate)?.wh ?? null;

    byInverter[inv.name] = { ...inv, latest, history, consumptionToday };
  }

  return { byInverter, shellInverters, today, selDate, minDate };
}
