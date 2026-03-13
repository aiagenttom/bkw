import { json } from '@sveltejs/kit';
import db from '$lib/db.js';
import { syncInverter } from '$lib/sync.js';

export async function POST({ params }) {
  const inv = db.prepare('SELECT * FROM inverters WHERE id = ?').get(parseInt(params.id));
  if (!inv) return json({ success: false, error: 'Inverter not found' });
  try {
    const result = await syncInverter(inv.name, inv.full_url, inv.serial);
    return json({ success: true, data: result });
  } catch (e) {
    return json({ success: false, error: e.message });
  }
}
