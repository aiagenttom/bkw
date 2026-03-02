import { json } from '@sveltejs/kit';
import db from '$lib/db.js';
import { syncInverter } from '$lib/sync.js';

export async function POST({ params }) {
  const inv = db.prepare('SELECT * FROM inverters WHERE id = ?').get(parseInt(params.id));
  if (!inv) return json({ success: false, error: 'Inverter not found' });
  try {
    const baseUrl = db.prepare("SELECT value FROM app_settings WHERE key = 'api_base_url'").get()?.value || '';
    const result  = await syncInverter(inv.name, inv.api_path, baseUrl, inv.full_url);
    return json({ success: true, data: result });
  } catch (e) {
    return json({ success: false, error: e.message });
  }
}
