import { json } from '@sveltejs/kit';
import db from '$lib/db.js';
import { getTzOffset, getLocalToday } from '$lib/tz.js';

function dayUtcRange(localDate, tzHours) {
  const startD = new Date(`${localDate}T00:00:00Z`);
  startD.setUTCHours(startD.getUTCHours() - tzHours);
  const endD = new Date(startD.getTime() + 24 * 3_600_000);
  const fmt = d => d.toISOString().replace('T', ' ').substring(0, 19);
  return { startUtc: fmt(startD), endUtc: fmt(endD) };
}

export function GET({ url }) {
  const today   = getLocalToday();
  const tzHours = getTzOffset(today);
  const syncMin = parseInt(
    db.prepare("SELECT value FROM app_settings WHERE key = 'sync_interval'").get()?.value ?? '1'
  );
  const { startUtc, endUtc } = dayUtcRange(today, tzHours);

  const invParam = url.searchParams.get('inv');

  const shellInverters = db.prepare(
    "SELECT id, name, color, shelly_url, shelly_feedin_phase FROM inverters WHERE enabled=1 AND shelly_url IS NOT NULL AND shelly_url != '' ORDER BY name"
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

    byInverter[inv.name] = { ...inv, latest, history, consumptionToday };
  }

  return json({ success: true, shellInverters, byInverter });
}
