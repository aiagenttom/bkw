import { fail } from '@sveltejs/kit';
import db from '$lib/db.js';
import { syncDaily } from '$lib/sync.js';

export async function load({ url }) {
  const months = parseInt(url.searchParams.get('months') || '3');

  const rows = db.prepare(`
    SELECT date, inverter, yield_wh, peak_w, avg_w, min_temp, max_temp, readings,
           savings_eur, avg_price_ct
    FROM bkw_daily
    WHERE date >= date('now', '-' || ? || ' months')
    ORDER BY date DESC, inverter
  `).all(months);

  // Pivot: { date → { inverter → row } }
  const byDate = {};
  for (const r of rows) {
    (byDate[r.date] ??= {})[r.inverter] = r;
  }

  // Per-inverter monthly totals
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', date) AS month,
           inverter,
           ROUND(SUM(yield_wh), 0)    AS total_wh,
           ROUND(MAX(peak_w), 1)      AS best_peak,
           ROUND(SUM(savings_eur), 2) AS total_savings,
           COUNT(*)                   AS days
    FROM bkw_daily
    WHERE date >= date('now', '-' || ? || ' months')
    GROUP BY month, inverter
    ORDER BY month DESC, inverter
  `).all(months);

  const priceMode = db.prepare("SELECT value FROM app_settings WHERE key = 'price_mode'").get()?.value || 'fixed';

  const inverters = [...new Set(rows.map(r => r.inverter))].sort();

  return { byDate, monthly, inverters, months, priceMode };
}

export const actions = {
  // Manual snapshot trigger for a specific date (or today)
  snapshot: async ({ request }) => {
    const d = await request.formData();
    const date = d.get('date')?.toString() || undefined;
    try {
      const result = syncDaily(date);
      return { success: `Snapshot saved: ${result?.length ?? 0} inverters` };
    } catch (e) {
      return fail(500, { error: e.message });
    }
  },
};
