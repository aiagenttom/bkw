import { json } from '@sveltejs/kit';
import db from '$lib/db.js';
import { getLocalToday } from '$lib/tz.js';

export function GET({ url }) {
  const date = url.searchParams.get('date') || getLocalToday();

  const rows = db.prepare(
    'SELECT hour, ghi, cloud_cover FROM weather_hourly WHERE date = ? ORDER BY hour'
  ).all(date);

  if (!rows.length) return json({ success: true, data: [] });

  return json({
    success: true,
    data: rows.map(r => ({ hour: r.hour, ghi: r.ghi ?? 0, cloudCover: r.cloud_cover ?? 0 })),
  });
}
