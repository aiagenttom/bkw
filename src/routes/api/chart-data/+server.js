import { json } from '@sveltejs/kit';
import db from '$lib/db.js';
import { getTzOffset, getLocalToday } from '$lib/tz.js';

export function GET({ url }) {
  const name = url.searchParams.get('name');
  const date = url.searchParams.get('date') || getLocalToday();
  const tzHours = getTzOffset(date);

  // Always restrict to enabled inverters so removed/disabled inverters don't appear
  const activeNames = db.prepare('SELECT name FROM inverters WHERE enabled = 1').all().map(r => r.name);

  // Only return data between 04:30 and 22:30 local time (solar-relevant window)
  const timeFilter = "AND time(datetime(log_time, '+' || ? || ' hours')) BETWEEN '04:30:00' AND '22:30:00'";

  let rows;
  if (name && name !== 'all') {
    // Specific inverter: only return if it's active
    if (!activeNames.includes(name)) {
      return json({ success: true, data: {}, date });
    }
    rows = db.prepare(
      `SELECT * FROM bkw_history WHERE date(datetime(log_time, '+' || ? || ' hours')) = ? AND name = ? ${timeFilter} ORDER BY log_time`
    ).all(tzHours, date, name, tzHours);
  } else {
    // All: filter by active inverters
    if (!activeNames.length) return json({ success: true, data: {}, date });
    const placeholders = activeNames.map(() => '?').join(',');
    rows = db.prepare(
      `SELECT * FROM bkw_history WHERE date(datetime(log_time, '+' || ? || ' hours')) = ? AND name IN (${placeholders}) ${timeFilter} ORDER BY log_time`
    ).all(tzHours, date, ...activeNames, tzHours);
  }

  const grouped = {};
  for (const r of rows) (grouped[r.name] ??= []).push(r);

  return json({ success: true, data: grouped, date });
}
