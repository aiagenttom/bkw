import { json } from '@sveltejs/kit';
import db from '$lib/db.js';

export function GET() {
  const dates = db.prepare(
    `SELECT DISTINCT date(log_time) AS d FROM bkw_history ORDER BY d DESC LIMIT 90`
  ).all().map(r => r.d);
  return json({ success: true, dates });
}
