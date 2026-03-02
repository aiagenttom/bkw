import { json } from '@sveltejs/kit';
import db from '$lib/db.js';

export function GET({ url }) {
  const date = url.searchParams.get('date') || new Date().toISOString().substring(0, 10);
  const tzOffset = parseInt(
    db.prepare("SELECT value FROM app_settings WHERE key = 'tz_offset_h'").get()?.value ?? '1'
  );

  // Convert UTC spotty_prices to local time, group by hour, avg per hour
  const rows = db.prepare(`
    SELECT
      CAST(strftime('%H', datetime(ts, '+' || ? || ' hours')) AS INTEGER) AS hour,
      ROUND(AVG(price), 3) AS avg_price
    FROM spotty_prices
    WHERE date(datetime(ts, '+' || ? || ' hours')) = ?
    GROUP BY hour
    ORDER BY hour
  `).all(tzOffset, tzOffset, date);

  return json({ success: true, data: rows, date });
}
