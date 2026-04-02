import db from '$lib/db.js';

/**
 * Effective Netzgebühr (ct/kWh) for a given hour, considering time-based discount.
 * @param {number} hour     - 0–23
 * @param {object} settings - app_settings as key→value map
 */
export function getEffectiveNetzCt(hour, settings) {
  const netzCt      = parseFloat(settings.netzgebuehr_ct   ?? '0');
  const start       = settings.netz_discount_start ?? '';
  const end         = settings.netz_discount_end   ?? '';
  const discountPct = parseFloat(settings.netz_discount_pct ?? '0');
  if (!start || !end || discountPct <= 0) return netzCt;
  const sh = parseInt(start.split(':')[0], 10);
  const eh = parseInt(end.split(':')[0],   10);
  return (hour >= sh && hour < eh)
    ? parseFloat((netzCt * (1 - discountPct / 100)).toFixed(4))
    : netzCt;
}

/**
 * Apply Stromrabatt price cap to a spot price.
 * If Stromrabatt is active and cumulative consumption is below the annual limit,
 * caps the effective price at stromrabatt_max_ct.
 * @param {number} basePriceCt   - spot price in ct/kWh
 * @param {object} settings
 * @param {number} cumulativeKwh - total consumption from April 1st so far (kWh)
 */
export function applyStromrabatt(basePriceCt, settings, cumulativeKwh) {
  if (settings.stromrabatt_active !== '1') return basePriceCt;
  const limitKwh = parseFloat(settings.stromrabatt_limit_kwh ?? '2900');
  const maxCt    = parseFloat(settings.stromrabatt_max_ct    ?? '6');
  return cumulativeKwh < limitKwh ? Math.min(basePriceCt, maxCt) : basePriceCt;
}

/**
 * Cumulative grid consumption (kWh) from April 1st of the relevant electricity year
 * up to (not including) upToDate.
 * Prefers smartmeter data; falls back to shelly_readings.
 * @param {string} upToDate  - ISO date YYYY-MM-DD
 * @param {number} tzOffset  - local UTC offset in hours
 */
export function getCumulativeKwhFromApril(upToDate, tzOffset = 1) {
  const d     = new Date(upToDate + 'T12:00:00Z');
  const month = d.getUTCMonth() + 1;
  const year  = d.getUTCFullYear();
  const april = `${month >= 4 ? year : year - 1}-04-01`;

  const smRow = db.prepare(
    'SELECT COALESCE(SUM(verbrauch_kwh), 0) AS total FROM smartmeter WHERE datum >= ? AND datum < ?'
  ).get(april, upToDate);
  if ((smRow?.total ?? 0) > 0) return smRow.total;

  const shRow = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN total_act_power > 0 THEN total_act_power ELSE 0 END), 0) / 60000.0 AS total
    FROM shelly_readings
    WHERE date(datetime(created_at, '+' || ? || ' hours')) >= ?
      AND date(datetime(created_at, '+' || ? || ' hours')) < ?
  `).get(tzOffset, april, tzOffset, upToDate);
  return shRow?.total ?? 0;
}

/**
 * Build a per-date map of cumulative kWh *before* each requested date, from April 1st.
 * Efficient single-query approach for the history page.
 * @param {string[]} dates   - sorted ISO date strings YYYY-MM-DD
 * @param {number}   tzOffset
 * @returns {{ [date: string]: number }}
 */
export function getCumulativeKwhByDate(dates, tzOffset = 1) {
  if (!dates.length) return {};
  const first = dates[0];
  const last  = dates[dates.length - 1];
  const d     = new Date(first + 'T12:00:00Z');
  const month = d.getUTCMonth() + 1;
  const year  = d.getUTCFullYear();
  const april = `${month >= 4 ? year : year - 1}-04-01`;

  let source = db.prepare(
    'SELECT datum AS date, SUM(verbrauch_kwh) AS kwh FROM smartmeter WHERE datum >= ? AND datum <= ? GROUP BY datum ORDER BY datum'
  ).all(april, last);

  if (!source.length) {
    source = db.prepare(`
      SELECT date(datetime(created_at, '+' || ? || ' hours')) AS date,
             SUM(CASE WHEN total_act_power > 0 THEN total_act_power ELSE 0 END) / 60000.0 AS kwh
      FROM shelly_readings
      WHERE date(datetime(created_at, '+' || ? || ' hours')) >= ?
        AND date(datetime(created_at, '+' || ? || ' hours')) <= ?
      GROUP BY date
      ORDER BY date
    `).all(tzOffset, tzOffset, april, tzOffset, last);
  }

  const dailyKwh = {};
  for (const r of source) dailyKwh[r.date] = r.kwh ?? 0;

  const dateSet  = new Set(dates);
  const allDates = [...new Set([...Object.keys(dailyKwh), ...dates])].sort();

  const result = {};
  let cumulative = 0;
  for (const date of allDates) {
    if (dateSet.has(date)) result[date] = cumulative;
    cumulative += dailyKwh[date] ?? 0;
  }
  return result;
}
