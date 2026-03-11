import { json } from '@sveltejs/kit';
import db from '$lib/db.js';
import { getTzOffset } from '$lib/tz.js';

/**
 * GET /api/historical-live?date=YYYY-MM-DD
 *
 * Returns the last recorded values from bkw_history for each enabled inverter
 * on the given date — used by the dashboard live-cards when viewing a past day.
 * Also calculates the day's savings (same logic as today-savings but for any date).
 */
export function GET({ url }) {
  const date = url.searchParams.get('date');
  if (!date) return json({ success: false, error: 'date parameter required' });

  const tzHours = getTzOffset(date);

  const inverters = db.prepare('SELECT * FROM inverters WHERE enabled = 1').all();
  const settings  = Object.fromEntries(
    db.prepare('SELECT key, value FROM app_settings').all().map(r => [r.key, r.value])
  );

  const globalMode  = settings.price_mode ?? 'fixed';
  const globalFixed = parseFloat(settings.fixed_price_ct ?? '30');
  const mwstPct     = parseFloat(settings.mwst_percent ?? '0');
  const netzCt      = parseFloat(settings.netzgebuehr_ct ?? '0');

  const data    = {};
  const savings = {};

  for (const inv of inverters) {
    // Last row of the day — shows the "end-of-day" state
    const lastRow = db.prepare(`
      SELECT * FROM bkw_history
      WHERE name = ?
        AND date(datetime(log_time, '+' || ? || ' hours')) = ?
      ORDER BY log_time DESC
      LIMIT 1
    `).get(inv.name, tzHours, date);

    // MAX(yield_day) = end-of-day total Wh (inverter resets at midnight)
    const yieldRow = db.prepare(`
      SELECT MAX(yield_day) AS max_yield
      FROM bkw_history
      WHERE name = ?
        AND date(datetime(log_time, '+' || ? || ' hours')) = ?
    `).get(inv.name, tzHours, date);

    const yieldWh = yieldRow?.max_yield ?? 0;

    data[inv.name] = lastRow ? {
      // Map history column names to the same keys the live API uses
      power_ac:    lastRow.power_ac_v,
      power_dc:    lastRow.power_dc_v,
      temperature: lastRow.temperature_v,
      yield_day:   yieldWh,          // total Wh for that day
      reachable:   null,             // null signals "historical" to the template
      synced_at:   lastRow.log_time,
    } : {};

    // ── Savings calculation for the selected date ──────────────────────────
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
        WHERE date(datetime(h.log_time, '+' || ? || ' hours')) = ?
          AND h.name = ?
          AND h.power_ac_v > 0
      `).get(tzHours, tzHours, tzHours, date, inv.name);
      priceCt = row?.avg_ct ?? fixedCt;
    }

    const totalCtPerKwh = (priceCt + netzCt) * (1 + mwstPct / 100);
    savings[inv.name]   = parseFloat((yieldWh / 1000 * totalCtPerKwh / 100).toFixed(4));
  }

  return json({ success: true, data, savings });
}
