import db from '$lib/db.js';

export async function load() {
  const inverters = db.prepare('SELECT * FROM inverters WHERE enabled = 1 ORDER BY name').all();

  // Compute local "today" using the configured tz_offset_h setting
  const tzRow   = db.prepare("SELECT value FROM app_settings WHERE key = 'tz_offset_h'").get();
  const tzHours = parseInt(tzRow?.value ?? '1');
  const localNow = new Date(Date.now() + tzHours * 3_600_000);
  const today   = localNow.toISOString().substring(0, 10);

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
  const tzOffset  = parseInt(settings.tz_offset_h ?? '1');
  const globalMode  = settings.price_mode ?? 'fixed';
  const globalFixed = parseFloat(settings.fixed_price_ct ?? '30');

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
        WHERE date(h.log_time) = ? AND h.name = ? AND h.power_ac_v > 0
      `).get(tzOffset, tzOffset, today, inv.name);
      priceCt = row?.avg_ct ?? fixedCt;
    }

    todaySavings[inv.name] = parseFloat((yieldWh / 1000 * priceCt / 100).toFixed(4));
  }

  return { inverters, summary, liveData, settings, today, todaySavings };
}
