import { json } from '@sveltejs/kit';
import db from '$lib/db.js';

export function GET({ url }) {
  const name = url.searchParams.get('name');
  const date = url.searchParams.get('date') || new Date().toISOString().substring(0,10);

  // Always restrict to enabled inverters so removed/disabled inverters don't appear
  const activeNames = db.prepare('SELECT name FROM inverters WHERE enabled = 1').all().map(r => r.name);

  let rows;
  if (name && name !== 'all') {
    // Specific inverter: only return if it's active
    if (!activeNames.includes(name)) {
      return json({ success: true, data: {}, date });
    }
    rows = db.prepare(`SELECT * FROM bkw_history WHERE date(log_time) = ? AND name = ? ORDER BY log_time`).all(date, name);
  } else {
    // All: filter by active inverters
    if (!activeNames.length) return json({ success: true, data: {}, date });
    const placeholders = activeNames.map(() => '?').join(',');
    rows = db.prepare(`SELECT * FROM bkw_history WHERE date(log_time) = ? AND name IN (${placeholders}) ORDER BY log_time`).all(date, ...activeNames);
  }

  const grouped = {};
  for (const r of rows) (grouped[r.name] ??= []).push(r);

  return json({ success: true, data: grouped, date });
}
