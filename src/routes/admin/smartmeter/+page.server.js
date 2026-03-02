import { fail } from '@sveltejs/kit';
import db from '$lib/db.js';

export async function load() {
  return {
    rows:  db.prepare('SELECT * FROM smartmeter ORDER BY datum DESC, zeit_von DESC LIMIT 200').all(),
    count: db.prepare('SELECT COUNT(*) AS c FROM smartmeter').get().c,
  };
}

export const actions = {
  import: async ({ request }) => {
    const data = await request.formData();
    const file = data.get('csvfile');
    if (!(file instanceof File) || file.size === 0)
      return fail(400, { error: 'No file uploaded' });

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());

    const insert = db.prepare(
      'INSERT OR REPLACE INTO smartmeter (datum, zeit_von, zeit_bis, verbrauch_kwh) VALUES (?,?,?,?)'
    );
    let imported = 0;
    db.exec('BEGIN');
    for (const line of lines) {
      const cols = line.split(';');
      if (cols.length >= 4) {
        insert.run(cols[0]?.trim(), cols[1]?.trim(), cols[2]?.trim(), parseFloat(cols[3]) || null);
        imported++;
      }
    }
    db.exec('COMMIT');
    return { success: `Imported ${imported} records` };
  },
};
