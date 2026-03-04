import { json } from '@sveltejs/kit';
import db from '$lib/db.js';

export function GET() {
  const settings = Object.fromEntries(
    db.prepare('SELECT key, value FROM app_settings').all().map(r => [r.key, r.value])
  );
  const tzOffset   = parseInt(settings.tz_offset_h ?? '1');
  const localNow   = new Date(Date.now() + tzOffset * 3_600_000);
  const today      = localNow.toISOString().substring(0, 10);
  const inverters  = db.prepare('SELECT * FROM inverters WHERE enabled = 1').all();
  const globalMode = settings.price_mode ?? 'fixed';
  const globalFixed = parseFloat(settings.fixed_price_ct ?? '30');

  const savings = {};
  for (const inv of inverters) {
    const table = `sync_live_dtu_${inv.name.toLowerCase().replace(/[^a-z0-9]/g,'_')}`;
    let yieldWh = 0;
    try {
      const row = db.prepare(`SELECT yield_day FROM ${table} ORDER BY synced_at DESC LIMIT 1`).get();
      yieldWh = row?.yield_day ?? 0;
    } catch { /* table not yet created */ }

    const mode    = inv.price_mode ?? globalMode;
    const fixedCt = inv.fixed_price_ct ?? globalFixed;

    let priceCt = fixedCt;
    if (mode === 'spotty') {
      const row = db.prepare(`
        SELECT ROUND(SUM(h.power_ac_v * sp.price) / NULLIF(SUM(h.power_ac_v), 0), 3) AS avg_ct
        FROM bkw_history h
        JOIN spotty_prices sp ON sp.ts = (
          strftime('%Y-%m-%dT%H:', datetime(h.log_time, '-' || ? || ' hours')) ||
          printf('%02d:00Z', (CAST(strftime('%M', datetime(h.log_time, '-' || ? || ' hours')) AS INTEGER) / 15) * 15)
        )
        WHERE date(datetime(h.log_time, '+' || ? || ' hours')) = ? AND h.name = ? AND h.power_ac_v > 0
      `).get(tzOffset, tzOffset, tzOffset, today, inv.name);
      priceCt = row?.avg_ct ?? fixedCt;
    }

    savings[inv.name] = parseFloat((yieldWh / 1000 * priceCt / 100).toFixed(4));
  }

  return json({ success: true, data: savings });
}
