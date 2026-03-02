import db from '$lib/db.js';

export async function load({ url }) {
  // How many months back to show (default: 3)
  const months = Math.min(parseInt(url.searchParams.get('months') || '3'), 24);

  const rows = db.prepare(`
    SELECT date, inverter, yield_wh, savings_eur, avg_price_ct
    FROM bkw_daily
    WHERE date >= date('now', '-' || ? || ' months')
    ORDER BY date ASC, inverter
  `).all(months);

  const inverters = db.prepare(
    'SELECT name, color FROM inverters WHERE enabled = 1 ORDER BY name'
  ).all();

  // Build list of all dates in range
  const dateSet = [...new Set(rows.map(r => r.date))].sort();

  // Per-date totals for "all inverters combined"
  const byDate = {};
  for (const r of rows) {
    if (!byDate[r.date]) byDate[r.date] = { yield_wh: 0, savings_eur: 0 };
    byDate[r.date].yield_wh    += r.yield_wh    ?? 0;
    byDate[r.date].savings_eur += r.savings_eur ?? 0;
  }

  // Per-inverter per-date map  { inverter → { date → { yield_wh, savings_eur } } }
  const byInverter = {};
  for (const r of rows) {
    (byInverter[r.inverter] ??= {})[r.date] = r;
  }

  // Monthly totals  [{ month, inverter, total_wh, total_savings }]
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', date) AS month,
           inverter,
           ROUND(SUM(yield_wh), 0)    AS total_wh,
           ROUND(SUM(savings_eur), 2) AS total_savings
    FROM bkw_daily
    WHERE date >= date('now', '-' || ? || ' months')
    GROUP BY month, inverter
    ORDER BY month ASC, inverter
  `).all(months);

  return { inverters, dateSet, byDate, byInverter, monthly, months };
}
