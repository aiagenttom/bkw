import { json } from '@sveltejs/kit';
import db from '$lib/db.js';
import { getTzOffset, getLocalToday } from '$lib/tz.js';
import { simulatePowerbankSavings, loadPowerbanks } from '$lib/powerbank.js';

export function GET() {
  const settings = Object.fromEntries(
    db.prepare('SELECT key, value FROM app_settings').all().map(r => [r.key, r.value])
  );
  const today      = getLocalToday();
  const tzOffset   = getTzOffset(today);
  const inverters  = db.prepare('SELECT * FROM inverters WHERE enabled = 1').all();
  const globalMode  = settings.price_mode ?? 'fixed';
  const globalFixed = parseFloat(settings.fixed_price_ct ?? '30');
  const mwstPct    = parseFloat(settings.mwst_percent ?? '0');
  const netzCt     = parseFloat(settings.netzgebuehr_ct ?? '0');

  // 100% Eigenverbrauch savings
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
    let priceCt   = fixedCt;

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

    const totalCtPerKwh = (priceCt + netzCt) * (1 + mwstPct / 100);
    savings[inv.name] = parseFloat((yieldWh / 1000 * totalCtPerKwh / 100).toFixed(4));
  }

  // Profile-based savings
  const jsDay  = new Date(today + 'T12:00:00').getDay();
  const weekday = jsDay === 0 ? 6 : jsDay - 1;

  const usageRows = db.prepare('SELECT inverter_id, hour, kw FROM usage_profiles WHERE weekday = ?').all(weekday);
  const usageByInverter = {};
  for (const r of usageRows) {
    if (!usageByInverter[r.inverter_id]) usageByInverter[r.inverter_id] = new Array(24).fill(0);
    usageByInverter[r.inverter_id][r.hour] = r.kw;
  }

  const needsSpotty = inverters.some(inv => (inv.price_mode ?? globalMode) === 'spotty');
  const hourlySpot = {};
  if (needsSpotty) {
    const spotRows = db.prepare(`
      SELECT CAST(strftime('%H', datetime(ts, '+' || ? || ' hours')) AS INTEGER) AS hour,
             AVG(price) AS avg_price
      FROM spotty_prices
      WHERE date(datetime(ts, '+' || ? || ' hours')) = ?
      GROUP BY hour
    `).all(tzOffset, tzOffset, today);
    for (const r of spotRows) hourlySpot[r.hour] = r.avg_price;
  }

  const savingsProfile   = {};
  const savingsPowerbank = {};
  const hasProfile = {};
  const powerbanks = loadPowerbanks(db);

  for (const inv of inverters) {
    const profile = usageByInverter[inv.id];
    const hasP    = !!profile && profile.some(v => v > 0);
    hasProfile[inv.name] = hasP;

    if (!hasP) {
      savingsProfile[inv.name]   = null;
      savingsPowerbank[inv.name] = null;
      continue;
    }

    const hourlyYield = db.prepare(`
      SELECT CAST(strftime('%H', datetime(log_time, '+' || ? || ' hours')) AS INTEGER) AS hour,
             AVG(power_ac_v) AS avg_w
      FROM bkw_history
      WHERE date(datetime(log_time, '+' || ? || ' hours')) = ? AND name = ?
      GROUP BY hour
    `).all(tzOffset, tzOffset, today, inv.name);

    const mode    = inv.price_mode ?? globalMode;
    const fixedCt = inv.fixed_price_ct ?? globalFixed;
    let totalEur  = 0;
    const hourlyData = [];

    for (const h of hourlyYield) {
      const eigenverbrauchWh = Math.min(h.avg_w, profile[h.hour] * 1000);
      const priceCt = mode === 'spotty' ? (hourlySpot[h.hour] ?? fixedCt) : fixedCt;
      const totalCtPerKwh = (priceCt + netzCt) * (1 + mwstPct / 100);
      totalEur += eigenverbrauchWh / 1000 * totalCtPerKwh / 100;
      hourlyData.push({ hour: h.hour, yieldWh: h.avg_w, profileWh: profile[h.hour] * 1000, priceCt });
    }

    // Powerbank-Zusatzersparnis – mit realem Morgen-SOC aus Anker-Readings
    const pb = powerbanks.get(inv.id);
    let pbEur = 0;
    if (pb) {
      const morningRow = db.prepare(`
        SELECT soc FROM anker_readings
        WHERE date(datetime(created_at, '+' || ? || ' hours')) = ?
        ORDER BY created_at ASC LIMIT 1
      `).get(tzOffset, today);
      const fallbackRow = !morningRow ? db.prepare(`
        SELECT soc FROM anker_readings
        WHERE date(datetime(created_at, '+' || ? || ' hours')) < ?
        ORDER BY created_at DESC LIMIT 1
      `).get(tzOffset, today) : null;
      const socPct       = (morningRow ?? fallbackRow)?.soc ?? 0;
      const initialSocWh = (socPct / 100) * pb.capacityWh;

      pbEur     = simulatePowerbankSavings(hourlyData, pb.capacityWh, pb.dischargeW, netzCt, mwstPct, initialSocWh, pb.dischargeStart, pb.dischargeEnd);
      totalEur += pbEur;
    }

    savingsProfile[inv.name]   = parseFloat(totalEur.toFixed(4));
    savingsPowerbank[inv.name] = pb ? parseFloat(pbEur.toFixed(4)) : null;
  }

  // Anker-Korrektur-Ertrag: Energie heute in Batterie → von OpenDTU nicht gemessen
  const syncMin = parseInt(settings.sync_interval ?? '1');
  const ankerChargeToday = {};
  for (const inv of inverters) {
    if (!powerbanks.has(inv.id)) { ankerChargeToday[inv.name] = null; continue; }
    const row = db.prepare(`
      SELECT ROUND(SUM(charge_w) * ? / 60.0, 1) AS charge_wh
      FROM anker_readings
      WHERE date(datetime(created_at, '+' || ? || ' hours')) = ?
        AND charge_w IS NOT NULL AND charge_w > 0
    `).get(syncMin, tzOffset, today);
    ankerChargeToday[inv.name] = row?.charge_wh ?? null;
  }

  return json({ success: true, data: savings, savingsProfile, savingsPowerbank, hasProfile, ankerChargeToday });
}
