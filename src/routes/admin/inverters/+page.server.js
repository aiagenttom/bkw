import { fail } from '@sveltejs/kit';
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
    for (const key of ['sync_interval', 'auto_refresh_s', 'spotty_url', 'timezone', 'price_mode', 'fixed_price_ct', 'mwst_percent', 'netzgebuehr_ct', 'shelly_url']) {
      const v = d.get(key);
      if (v !== null) upd.run(v.toString().trim(), key);
    }
    return { success: 'Settings saved' };
  },

  update: async ({ request }) => {
    const d    = await request.formData();
    const id   = parseInt(d.get('id'));
    const name = d.get('name')?.toString().trim();
    if (!name) return fail(400, { error: 'Name required' });
    const priceMode    = d.get('price_mode')?.toString() || 'global';
    const fixedPriceCt = d.get('fixed_price_ct')?.toString().trim();
    const kwpVal       = d.get('kwp')?.toString().trim();
    const serial       = d.get('serial')?.toString().trim() || null;
    const shellyUrl         = d.get('shelly_url')?.toString().trim() || null;
    const shellyFeedinPhase = d.get('shelly_feedin_phase')?.toString() || '';
    const shellyPhaseALabel = d.get('shelly_phase_a_label')?.toString().trim() || null;
    const shellyPhaseBLabel = d.get('shelly_phase_b_label')?.toString().trim() || null;
    const shellyPhaseCLabel = d.get('shelly_phase_c_label')?.toString().trim() || null;
    db.prepare(`UPDATE inverters
      SET name=?, full_url=?, serial=?, color=?, price_mode=?, fixed_price_ct=?, kwp=?,
          shelly_url=?, shelly_feedin_phase=?,
          shelly_phase_a_label=?, shelly_phase_b_label=?, shelly_phase_c_label=?
      WHERE id=?`).run(
      name,
      d.get('full_url')?.toString().trim() || null,
      serial,
      d.get('color')?.toString().trim() || '#3498db',
      priceMode === 'global' ? null : priceMode,
      fixedPriceCt ? parseFloat(fixedPriceCt) : null,
      kwpVal ? parseFloat(kwpVal) : 0,
      shellyUrl,
      shellyFeedinPhase || null,
      shellyPhaseALabel,
      shellyPhaseBLabel,
      shellyPhaseCLabel,
      id
    );
    return { success: `Inverter ${name} saved` };
  },

  add: async ({ request }) => {
    const d      = await request.formData();
    const name   = d.get('name')?.toString().trim();
    if (!name) return fail(400, { error: 'Name required' });
    const serial = d.get('serial')?.toString().trim() || null;
    try {
      db.prepare('INSERT INTO inverters (name, full_url, serial, color, enabled) VALUES (?,?,?,?,1)').run(
        name,
        d.get('full_url')?.toString().trim() || null,
        serial,
        d.get('color')?.toString().trim() || '#3498db'
      );
    } catch (e) { return fail(400, { error: e.message }); }
    return { success: `Inverter ${name} created` };
  },

  delete: async ({ request }) => {
    const d = await request.formData();
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
