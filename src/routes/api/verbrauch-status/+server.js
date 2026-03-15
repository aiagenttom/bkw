import { json } from '@sveltejs/kit';
import db from '$lib/db.js';
import { getTzOffset, getLocalToday } from '$lib/tz.js';

export function GET() {
  const syncMin = parseInt(
    db.prepare("SELECT value FROM app_settings WHERE key = 'sync_interval'").get()?.value ?? '1'
  );

  const latest = db.prepare(`
    SELECT total_act_power, a_act_power, b_act_power, c_act_power,
           a_voltage, b_voltage, c_voltage, total_energy_wh,
           strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS ts
    FROM shelly_readings
    ORDER BY created_at DESC LIMIT 1
  `).get() ?? null;

  const history = db.prepare(`
    SELECT strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS ts,
           total_act_power, a_act_power, b_act_power, c_act_power
    FROM shelly_readings
    WHERE created_at >= datetime('now', '-24 hours')
    ORDER BY created_at ASC
  `).all();

  const today   = getLocalToday();
  const tzHours = getTzOffset(today);

  const consumptionToday = db.prepare(`
    SELECT ROUND(SUM(CASE WHEN total_act_power > 0 THEN total_act_power ELSE 0 END) * ? / 60.0, 1) AS wh
    FROM shelly_readings
    WHERE date(datetime(created_at, '+' || ? || ' hours')) = ?
  `).get(syncMin, tzHours, today)?.wh ?? null;

  // Online = letzter Messwert < 5 Minuten alt
  const serviceOnline = latest
    ? (Date.now() - new Date(latest.ts).getTime()) < 5 * 60 * 1000
    : false;

  return json({ success: true, latest, history, consumptionToday, serviceOnline });
}
