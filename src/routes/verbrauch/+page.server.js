import db from '$lib/db.js';
import { getTzOffset, getLocalToday } from '$lib/tz.js';

function getSetting(key) {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
}

export async function load() {
  const today   = getLocalToday();
  const tzHours = getTzOffset(today);
  const syncMin = parseInt(getSetting('sync_interval') ?? '1');

  // Alle Inverter mit konfigurierter Shelly-URL
  const shellInverters = db.prepare(
    "SELECT id, name, color, shelly_url FROM inverters WHERE enabled=1 AND shelly_url IS NOT NULL AND shelly_url != '' ORDER BY name"
  ).all();

  const byInverter = {};
  for (const inv of shellInverters) {
    const latest = db.prepare(`
      SELECT total_act_power, a_act_power, b_act_power, c_act_power,
             a_voltage, b_voltage, c_voltage,
             strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS ts
      FROM shelly_readings
      WHERE inverter_name = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(inv.name) ?? null;

    const history = db.prepare(`
      SELECT strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS ts,
             total_act_power, a_act_power, b_act_power, c_act_power
      FROM shelly_readings
      WHERE inverter_name = ? AND created_at >= datetime('now', '-24 hours')
      ORDER BY created_at ASC
    `).all(inv.name);

    const consumptionToday = db.prepare(`
      SELECT ROUND(SUM(CASE WHEN total_act_power > 0 THEN total_act_power ELSE 0 END) * ? / 60.0, 1) AS wh
      FROM shelly_readings
      WHERE inverter_name = ?
        AND date(datetime(created_at, '+' || ? || ' hours')) = ?
    `).get(syncMin, inv.name, tzHours, today)?.wh ?? null;

    byInverter[inv.name] = { ...inv, latest, history, consumptionToday };
  }

  return { byInverter, shellInverters };
}
