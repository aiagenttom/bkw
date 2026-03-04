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

  const settings = Object.fromEntries(
    db.prepare('SELECT key, value FROM app_settings').all().map(r => [r.key, r.value])
  );

  // Recalculate savings_eur using current MwSt + Netzgebühr settings
  const mwstPct   = parseFloat(settings.mwst_percent   ?? '0');
  const netzCt    = parseFloat(settings.netzgebuehr_ct  ?? '0');
  const globalMode  = settings.price_mode ?? 'fixed';
  const globalFixed = parseFloat(settings.fixed_price_ct ?? '30');

  // Per-inverter fixed price lookup
  const invSettings = {};
  for (const inv of inverters) {
    const row = db.prepare('SELECT price_mode, fixed_price_ct FROM inverters WHERE name = ?').get(inv.name);
    invSettings[inv.name] = row;
  }

  for (const r of rows) {
    const mode    = invSettings[r.inverter]?.price_mode ?? globalMode;
    const fixedCt = invSettings[r.inverter]?.fixed_price_ct ?? globalFixed;
    const priceCt = (mode === 'spotty' && r.avg_price_ct != null) ? r.avg_price_ct : fixedCt;
    const totalCtPerKwh = (priceCt + netzCt) * (1 + mwstPct / 100);
    r.savings_eur = r.yield_wh != null
      ? parseFloat((r.yield_wh / 1000 * totalCtPerKwh / 100).toFixed(4))
      : null;
  }

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

  // Monthly totals (recalculated from rows with current tax settings)
  const monthlyMap = {};
  for (const r of rows) {
    const month = r.date.substring(0, 7);
    const key = `${month}|${r.inverter}`;
    if (!monthlyMap[key]) monthlyMap[key] = { month, inverter: r.inverter, total_wh: 0, total_savings: 0 };
    monthlyMap[key].total_wh      += r.yield_wh     ?? 0;
    monthlyMap[key].total_savings += r.savings_eur  ?? 0;
  }
  const monthly = Object.values(monthlyMap)
    .map(m => ({ ...m, total_wh: Math.round(m.total_wh), total_savings: parseFloat(m.total_savings.toFixed(2)) }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.inverter.localeCompare(b.inverter));

  return { inverters, dateSet, byDate, byInverter, monthly, months };
}
