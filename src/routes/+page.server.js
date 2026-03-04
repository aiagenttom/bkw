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

  // Today's savings per inverter (live calculation based on yield_day + tariff)
  const globalMode  = settings.price_mode ?? 'fixed';
  const globalFixed = parseFloat(settings.fixed_price_ct ?? '30');
  const mwstPct     = parseFloat(settings.mwst_percent ?? '0');
  const netzCt      = parseFloat(settings.netzgebuehr_ct ?? '0');

  const todaySavings = {};
  for (const inv of inverters) {
    const live     = liveData[inv.name] ?? {};
    const yieldWh  = live.yield_day ?? 0;
    const mode     = inv.price_mode ?? globalMode;
    const fixedCt  = inv.fixed_price_ct ?? globalFixed;

    let priceCt = fixedCt;
    if (mode === 'spotty') {
      // Production-weighted avg spot price for today so far
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

  return { inverters, summary, liveData, settings, today, todaySavings };
}
