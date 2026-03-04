import { json } from '@sveltejs/kit';
import db from '$lib/db.js';

export function GET() {
  const tzRow   = db.prepare("SELECT value FROM app_settings WHERE key = 'tz_offset_h'").get();
  const tzHours = parseInt(tzRow?.value ?? '1');
  const dates = db.prepare(
    `SELECT DISTINCT date(datetime(log_time, '+' || ? || ' hours')) AS d FROM bkw_history ORDER BY d DESC LIMIT 90`
  ).all(tzHours).map(r => r.d);
  return json({ success: true, dates });
}
