import { fail } from '@sveltejs/kit';
import db from '$lib/db.js';

export async function load() {
  const inverters = db.prepare('SELECT id, name, color, kwp FROM inverters WHERE enabled = 1 ORDER BY name').all();

  // Load all profiles grouped by inverter
  const allProfiles = db.prepare('SELECT inverter_id, weekday, hour, kw FROM usage_profiles ORDER BY inverter_id, weekday, hour').all();

  // Build nested map: { inverterId: { weekday: [24 kw values] } }
  const profiles = {};
  for (const inv of inverters) {
    profiles[inv.id] = {};
    for (let wd = 0; wd < 7; wd++) {
      profiles[inv.id][wd] = new Array(24).fill(0);
    }
  }
  for (const row of allProfiles) {
    if (profiles[row.inverter_id]) {
      profiles[row.inverter_id][row.weekday][row.hour] = row.kw;
    }
  }

  return { inverters, profiles };
}

export const actions = {
  saveProfile: async ({ request }) => {
    const d = await request.formData();
    const inverterId = parseInt(d.get('inverter_id'));
    const dataJson = d.get('data');

    if (!inverterId || !dataJson) return fail(400, { error: 'Missing data' });

    let data;
    try { data = JSON.parse(dataJson); } catch { return fail(400, { error: 'Invalid JSON' }); }

    // data = { weekday: [24 kw values], ... } e.g. { "0": [0,0,...], "1": [...], ... }
    const ins = db.prepare('INSERT OR REPLACE INTO usage_profiles (inverter_id, weekday, hour, kw) VALUES (?,?,?,?)');
    let rowCount = 0;
    const saveTransaction = db.transaction(() => {
      for (const [wd, hours] of Object.entries(data)) {
        const weekday = parseInt(wd);
        if (weekday < 0 || weekday > 6 || !Array.isArray(hours)) continue;
        for (let h = 0; h < 24; h++) {
          const kw = parseFloat(hours[h] || 0);
          ins.run(inverterId, weekday, h, Math.round(kw * 100) / 100);
          rowCount++;
        }
      }
    });
    saveTransaction();
    console.log(`[usage-profile] Saved ${rowCount} rows for inverter ${inverterId}`);
    return { success: `Verbrauchsprofil gespeichert (${rowCount} Einträge)` };
  },
};
