import { fail, redirect } from '@sveltejs/kit';
import db from '$lib/db.js';
import { syncInverter } from '$lib/sync.js';

export async function load() {
  return {
    inverters: db.prepare('SELECT * FROM inverters ORDER BY name').all(),
    settings:  Object.fromEntries(
      db.prepare('SELECT key, value FROM app_settings').all().map(r => [r.key, r.value])
    ),
  };
}

export const actions = {
  saveSettings: async ({ request }) => {
    const d = await request.formData();
    const upd = db.prepare('UPDATE app_settings SET value = ? WHERE key = ?');
    for (const key of ['api_base_url', 'sync_interval', 'auto_refresh_s', 'spotty_url', 'tz_offset_h', 'price_mode', 'fixed_price_ct']) {
      const v = d.get(key);
      if (v !== null) upd.run(v.toString().trim(), key);
    }
    return { success: 'Settings saved' };
  },

  update: async ({ request }) => {
    const d   = await request.formData();
    const id  = parseInt(d.get('id'));
    const name = d.get('name')?.toString().trim();
    if (!name) return fail(400, { error: 'Name required' });
    // price_mode: if "global" → store NULL (use global default)
    const priceMode   = d.get('price_mode')?.toString() || 'global';
    const fixedPriceCt = d.get('fixed_price_ct')?.toString().trim();
    db.prepare('UPDATE inverters SET name=?, full_url=?, api_path=?, color=?, price_mode=?, fixed_price_ct=? WHERE id=?').run(
      name,
      d.get('full_url')?.toString().trim() || null,
      d.get('api_path')?.toString().trim() || '',
      d.get('color')?.toString().trim() || '#3498db',
      priceMode === 'global' ? null : priceMode,
      fixedPriceCt ? parseFloat(fixedPriceCt) : null,
      id
    );
    return { success: `Inverter ${name} saved` };
  },

  add: async ({ request }) => {
    const d = await request.formData();
    const name = d.get('name')?.toString().trim();
    if (!name) return fail(400, { error: 'Name required' });
    try {
      db.prepare('INSERT INTO inverters (name, full_url, api_path, color, enabled) VALUES (?,?,?,?,1)').run(
        name,
        d.get('full_url')?.toString().trim() || null,
        d.get('api_path')?.toString().trim() || '',
        d.get('color')?.toString().trim() || '#3498db'
      );
    } catch (e) { return fail(400, { error: e.message }); }
    return { success: `Inverter ${name} created` };
  },

  delete: async ({ request }) => {
    const d  = await request.formData();
    db.prepare('DELETE FROM inverters WHERE id = ?').run(parseInt(d.get('id')));
    return { success: 'Inverter deleted' };
  },

  toggle: async ({ request }) => {
    const d   = await request.formData();
    const id  = parseInt(d.get('id'));
    const inv = db.prepare('SELECT enabled FROM inverters WHERE id = ?').get(id);
    if (inv) db.prepare('UPDATE inverters SET enabled = ? WHERE id = ?').run(inv.enabled ? 0 : 1, id);
    return { success: 'Updated' };
  },
};
