import db from '$lib/db.js';
import { getTzOffset, getLocalToday } from '$lib/tz.js';

export async function load() {
  const inverters = db.prepare('SELECT * FROM inverters WHERE enabled = 1 ORDER BY name').all();

  const today   = getLocalToday();
  const tzHours = getTzOffset(today);

  const summary = db.prepare(`
    SELECT h.name,
           ROUND(MAX(h.power_dc_v),1) AS peak_power,
           ROUND(AVG(h.power_dc_v),1) AS avg_power
    FROM bkw_history h
    JOIN inverters i ON i.name = h.name AND i.enabled = 1
    WHERE date(datetime(h.log_time, '+' || ? || ' hours')) = ?
    GROUP BY h.name
  `).all(tzHours, today);

  // Live data per inverter (dynamic table lookup)
  const liveData = {};
  for (const inv of inverters) {
    const table = `sync_live_dtu_${inv.name.toLowerCase().replace(/[^a-z0-9]/g,'_')}`;
    try {
      liveData[inv.name] = db.prepare(
        `SELECT * FROM ${table} ORDER BY synced_at DESC LIMIT 1`
      ).get() ?? {};
    } catch { liveData[inv.name] = {}; }
  }

  const settings = Object.fromEntries(
    db.prepare('SELECT key, value FROM app_settings').all().map(r => [r.key, r.value])
  );

  const globalMode  = settings.price_mode ?? 'fixed';
  const globalFixed = parseFloat(settings.fixed_price_ct ?? '30');
  const mwstPct     = parseFloat(settings.mwst_percent ?? '0');
  const netzCt      = parseFloat(settings.netzgebuehr_ct ?? '0');

  // Today's savings per inverter – 100% Eigenverbrauch assumed
  const todaySavings = {};
  for (const inv of inverters) {
    const live     = liveData[inv.name] ?? {};
    const yieldWh  = live.yield_day ?? 0;
    const mode     = inv.price_mode ?? globalMode;
    const fixedCt  = inv.fixed_price_ct ?? globalFixed;

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
      `).get(tzHours, tzHours, tzHours, today, inv.name);
      priceCt = row?.avg_ct ?? fixedCt;
    }

    const totalCtPerKwh = (priceCt + netzCt) * (1 + mwstPct / 100);
    todaySavings[inv.name] = parseFloat((yieldWh / 1000 * totalCtPerKwh / 100).toFixed(4));
  }

  // Profile-based savings – Eigenverbrauch = min(yield, profile) per hour
  const jsDay  = new Date(today + 'T12:00:00').getDay();
  const weekday = jsDay === 0 ? 6 : jsDay - 1;

  const usageRows = db.prepare('SELECT inverter_id, hour, kw FROM usage_profiles WHERE weekday = ?').all(weekday);
  const usageByInverter = {};
  for (const r of usageRows) {
    if (!usageByInverter[r.inverter_id]) usageByInverter[r.inverter_id] = new Array(24).fill(0);
    usageByInverter[r.inverter_id][r.hour] = r.kw;
  }

  // Hourly spot prices for today (only needed if any inverter uses spotty mode)
  const needsSpotty = inverters.some(inv => (inv.price_mode ?? globalMode) === 'spotty');
  const hourlySpot = {};
  if (needsSpotty) {
    const spotRows = db.prepare(`
      SELECT CAST(strftime('%H', datetime(ts, '+' || ? || ' hours')) AS INTEGER) AS hour,
             AVG(price) AS avg_price
      FROM spotty_prices
      WHERE date(datetime(ts, '+' || ? || ' hours')) = ?
      GROUP BY hour
    `).all(tzHours, tzHours, today);
    for (const r of spotRows) hourlySpot[r.hour] = r.avg_price;
  }

  const todaySavingsProfile = {};
  const hasProfile = {};

  for (const inv of inverters) {
    const profile = usageByInverter[inv.id];
    const hasP    = !!profile && profile.some(v => v > 0);
    hasProfile[inv.name] = hasP;

    if (!hasP) { todaySavingsProfile[inv.name] = null; continue; }

    // Hourly yield: AVG(power_ac_v) per hour ≈ avg watts → 1h → Wh
    const hourlyYield = db.prepare(`
      SELECT CAST(strftime('%H', datetime(log_time, '+' || ? || ' hours')) AS INTEGER) AS hour,
             AVG(power_ac_v) AS avg_w
      FROM bkw_history
      WHERE date(datetime(log_time, '+' || ? || ' hours')) = ? AND name = ?
      GROUP BY hour
    `).all(tzHours, tzHours, today, inv.name);

    const mode    = inv.price_mode ?? globalMode;
    const fixedCt = inv.fixed_price_ct ?? globalFixed;
    let totalEur  = 0;

    for (const h of hourlyYield) {
      const yieldWh        = h.avg_w;                           // W·h over 1h
      const profileWh      = profile[h.hour] * 1000;           // kW → Wh
      const eigenverbrauchWh = Math.min(yieldWh, profileWh);

      const priceCt = mode === 'spotty' ? (hourlySpot[h.hour] ?? fixedCt) : fixedCt;
      const totalCtPerKwh = (priceCt + netzCt) * (1 + mwstPct / 100);
      totalEur += eigenverbrauchWh / 1000 * totalCtPerKwh / 100;
    }

    todaySavingsProfile[inv.name] = parseFloat(totalEur.toFixed(4));
  }

  return { inverters, summary, liveData, settings, today, todaySavings, todaySavingsProfile, hasProfile };
}
