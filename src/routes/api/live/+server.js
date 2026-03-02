import { json } from '@sveltejs/kit';
import db from '$lib/db.js';

export function GET() {
  const inverters = db.prepare('SELECT * FROM inverters WHERE enabled = 1').all();
  const data = {};
  for (const inv of inverters) {
    const table = `sync_live_dtu_${inv.name.toLowerCase().replace(/[^a-z0-9]/g,'_')}`;
    try {
      data[inv.name] = db.prepare(`SELECT * FROM ${table} ORDER BY synced_at DESC LIMIT 1`).get() ?? null;
    } catch { data[inv.name] = null; }
  }
  return json({ success: true, data });
}
