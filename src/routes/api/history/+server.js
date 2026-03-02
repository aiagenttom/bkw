import { json } from '@sveltejs/kit';
import db from '$lib/db.js';

export function GET({ url }) {
  const name  = url.searchParams.get('name');
  const date  = url.searchParams.get('date') || new Date().toISOString().substring(0,10);
  const limit = parseInt(url.searchParams.get('limit') || '100');

  const rows = name && name !== 'all'
    ? db.prepare(`SELECT * FROM bkw_history WHERE date(log_time) = ? AND name = ? ORDER BY log_time DESC LIMIT ?`).all(date, name, limit)
    : db.prepare(`SELECT * FROM bkw_history WHERE date(log_time) = ? ORDER BY log_time DESC LIMIT ?`).all(date, limit);

  return json({ success: true, data: rows });
}
