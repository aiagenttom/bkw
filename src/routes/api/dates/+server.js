import { json } from '@sveltejs/kit';
import db from '$lib/db.js';
import { getTzOffset } from '$lib/tz.js';

export function GET() {
  const tzHours = getTzOffset();
  const dates = db.prepare(
    `SELECT DISTINCT date(datetime(log_time, '+' || ? || ' hours')) AS d FROM bkw_history ORDER BY d DESC LIMIT 90`
  ).all(tzHours).map(r => r.d);
  return json({ success: true, dates });
}
