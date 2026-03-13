import db from '$lib/db.js';
import { getTzOffset } from '$lib/tz.js';

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
    'SELECT id, name, color FROM inverters WHERE enabled = 1 ORDER BY name'
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

  // ── Profile-based savings ──────────────────────────────────────────────────
  const invIdByName = Object.fromEntries(inverters.map(i => [i.name, i.id]));

  const profileRows = db.prepare('SELECT inverter_id, weekday, hour, kw FROM usage_profiles').all();
  const profiles = {};
  for (const r of profileRows) {
    profiles[r.inverter_id] ??= {};
    profiles[r.inverter_id][r.weekday] ??= new Array(24).fill(0);
    profiles[r.inverter_id][r.weekday][r.hour] = r.kw;
  }

  const hasSavingsProfile = profileRows.some(r => r.kw > 0);

  if (hasSavingsProfile && dateSet.length > 0) {
    // Group dates by tz offset (typically 2 groups: CET=1, CEST=2)
    const datesByTz = {};
    for (const date of dateSet) {
      const tz = getTzOffset(date);
      (datesByTz[tz] ??= []).push(date);
    }

    for (const [tz, dates] of Object.entries(datesByTz)) {
      const tzInt = parseInt(tz);
      const placeholders = dates.map(() => '?').join(',');
      const hourlyRows = db.prepare(`
        SELECT
          date(datetime(log_time, '+' || ? || ' hours')) AS day,
          name AS inverter,
          CAST(strftime('%H', datetime(log_time, '+' || ? || ' hours')) AS INTEGER) AS hour,
          AVG(power_ac_v) AS avg_w
        FROM bkw_history
        WHERE date(datetime(log_time, '+' || ? || ' hours')) IN (${placeholders})
        GROUP BY day, inverter, hour
      `).all(tzInt, tzInt, tzInt, ...dates);

      for (const h of hourlyRows) {
        const invId = invIdByName[h.inverter];
        if (invId == null) continue;

        const jsDay  = new Date(h.day + 'T12:00:00').getDay();
        const weekday = jsDay === 0 ? 6 : jsDay - 1;
        const profile = profiles[invId]?.[weekday];
        if (!profile) continue;

        const profileWh = profile[h.hour] * 1000;
        const eigenWh   = Math.min(h.avg_w ?? 0, profileWh);
        if (eigenWh <= 0) continue;

        const dailyRow = byInverter[h.inverter]?.[h.day];
        const inv      = invSettings[h.inverter];
        const mode     = inv?.price_mode ?? globalMode;
        const fixedCt  = inv?.fixed_price_ct ?? globalFixed;
        const priceCt  = (mode === 'spotty' && dailyRow?.avg_price_ct != null)
          ? dailyRow.avg_price_ct : fixedCt;
        const totalCtPerKwh = (priceCt + netzCt) * (1 + mwstPct / 100);
        const eur = eigenWh / 1000 * totalCtPerKwh / 100;

        if (byInverter[h.inverter]?.[h.day]) {
          byInverter[h.inverter][h.day].savings_profile_eur =
            (byInverter[h.inverter][h.day].savings_profile_eur ?? 0) + eur;
        }
        if (byDate[h.day]) {
          byDate[h.day].savings_profile_eur = (byDate[h.day].savings_profile_eur ?? 0) + eur;
        }
      }
    }

    // Round accumulated values
    for (const date of dateSet) {
      if (byDate[date]?.savings_profile_eur != null)
        byDate[date].savings_profile_eur = parseFloat(byDate[date].savings_profile_eur.toFixed(4));
      for (const inv of inverters) {
        const r = byInverter[inv.name]?.[date];
        if (r?.savings_profile_eur != null)
          r.savings_profile_eur = parseFloat(r.savings_profile_eur.toFixed(4));
      }
    }

    // Monthly profile savings totals
    for (const m of monthly) {
      let total = 0;
      const invData = byInverter[m.inverter];
      if (invData) {
        for (const [date, row] of Object.entries(invData)) {
          if (date.startsWith(m.month)) total += row.savings_profile_eur ?? 0;
        }
      }
      m.total_savings_profile = parseFloat(total.toFixed(2));
    }
  }

  return { inverters, dateSet, byDate, byInverter, monthly, months, hasSavingsProfile };
}
