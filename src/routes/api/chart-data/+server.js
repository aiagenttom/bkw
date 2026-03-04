import { json } from '@sveltejs/kit';
import db from '$lib/db.js';

export function GET({ url }) {
  const name = url.searchParams.get('name');
  const tzRow   = db.prepare("SELECT value FROM app_settings WHERE key = 'tz_offset_h'").get();
  const tzHours = parseInt(tzRow?.value ?? '1');
  // Default to local today using the same tz offset
  const localNow = new Date(Date.now() + tzHours * 3_600_000);
  const date = url.searchParams.get('date') || localNow.toISOString().substring(0, 10);

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
