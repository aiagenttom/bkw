import db from '$lib/db.js';
import { getTzOffset, getLocalToday } from '$lib/tz.js';
import { simulatePowerbankSavings, loadPowerbanks } from '$lib/powerbank.js';
import { getEffectiveNetzCt, applyStromrabatt, getCumulativeKwhFromApril } from '$lib/tarifutils.js';

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

  const cumulKwhFromApril = getCumulativeKwhFromApril(today, tzHours);

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

    const effectivePriceCt = applyStromrabatt(priceCt, settings, cumulKwhFromApril, inv.stromrabatt_active === 1);
    const totalCtPerKwh = (effectivePriceCt + netzCt) * (1 + mwstPct / 100);
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

  const todaySavingsProfile   = {};
  const todaySavingsPowerbank = {};
  const hasProfile = {};
  const powerbanks = loadPowerbanks(db);

  for (const inv of inverters) {
    const profile = usageByInverter[inv.id];
    const hasP    = !!profile && profile.some(v => v > 0);
    hasProfile[inv.name] = hasP;

    if (!hasP) {
      todaySavingsProfile[inv.name]   = null;
      todaySavingsPowerbank[inv.name] = null;
      continue;
    }

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
    const hourlyData = [];

    for (const h of hourlyYield) {
      const yieldWh          = h.avg_w;
      const profileWh        = profile[h.hour] * 1000;
      const eigenverbrauchWh = Math.min(yieldWh, profileWh);
      const spotPriceCt      = mode === 'spotty' ? (hourlySpot[h.hour] ?? fixedCt) : fixedCt;
      const priceCt          = applyStromrabatt(spotPriceCt, settings, cumulKwhFromApril, inv.stromrabatt_active === 1);
      const effectiveNetzCt  = getEffectiveNetzCt(h.hour, settings, parseInt(today.split('-')[2], 10));
      const totalCtPerKwh    = (priceCt + effectiveNetzCt) * (1 + mwstPct / 100);
      totalEur += eigenverbrauchWh / 1000 * totalCtPerKwh / 100;
      hourlyData.push({ hour: h.hour, yieldWh, profileWh, priceCt });
    }

    // Powerbank-Zusatzersparnis – mit realem Morgen-SOC aus Anker-Readings
    const pb = powerbanks.get(inv.id);
    let pbEur = 0;
    if (pb) {
      // Erster Anker-SOC des heutigen Tages (= Ladezustand nach der Nacht)
      const morningRow = db.prepare(`
        SELECT soc FROM anker_readings
        WHERE date(datetime(created_at, '+' || ? || ' hours')) = ?
        ORDER BY created_at ASC LIMIT 1
      `).get(tzHours, today);
      // Fallback: letzter bekannter SOC von gestern
      const fallbackRow = !morningRow ? db.prepare(`
        SELECT soc FROM anker_readings
        WHERE date(datetime(created_at, '+' || ? || ' hours')) < ?
        ORDER BY created_at DESC LIMIT 1
      `).get(tzHours, today) : null;
      const socPct      = (morningRow ?? fallbackRow)?.soc ?? 0;
      const initialSocWh = (socPct / 100) * pb.capacityWh;

      pbEur     = simulatePowerbankSavings(hourlyData, pb.capacityWh, pb.dischargeW, netzCt, mwstPct, initialSocWh, pb.dischargeStart, pb.dischargeEnd);
      totalEur += pbEur;
    }

    todaySavingsProfile[inv.name]   = parseFloat(totalEur.toFixed(4));
    todaySavingsPowerbank[inv.name] = pb ? parseFloat(pbEur.toFixed(4)) : null;
  }

  // Anker-Messwerte für heute:
  //   charge_wh:    Energie heute von Panels IN die Batterie (Hoymiles sieht sie NICHT)
  //   discharge_wh: Energie heute von der Batterie ANS HAUS (= tatsächliche Leistung der Powerbank)
  const syncMin = parseInt(db.prepare("SELECT value FROM app_settings WHERE key = 'sync_interval'").get()?.value ?? '1');
  const ankerChargeToday    = {};
  const ankerDischargeToday = {};
  for (const inv of inverters) {
    if (!powerbanks.has(inv.id)) {
      ankerChargeToday[inv.name]    = null;
      ankerDischargeToday[inv.name] = null;
      continue;
    }
    const row = db.prepare(`
      SELECT
        ROUND(SUM(CASE WHEN charge_w    > 0 THEN charge_w    ELSE 0 END) * ? / 60.0, 1) AS charge_wh,
        ROUND(SUM(CASE WHEN discharge_w > 0 THEN discharge_w ELSE 0 END) * ? / 60.0, 1) AS discharge_wh
      FROM anker_readings
      WHERE date(datetime(created_at, '+' || ? || ' hours')) = ?
    `).get(syncMin, syncMin, tzHours, today);
    ankerChargeToday[inv.name]    = row?.charge_wh    ?? null;
    ankerDischargeToday[inv.name] = row?.discharge_wh ?? null;
  }

  // ── Shelly Pro 3EM – aktueller Verbrauch + Tages-Wh ────────────────────────
  // ── Shelly per Inverter ─────────────────────────────────────────────────────
  const shellyLiveByInv            = {};
  const shellyConsumptionTodayByInv = {};
  for (const inv of inverters) {
    if (!inv.shelly_url?.trim()) continue;
    shellyLiveByInv[inv.name] = db.prepare(
      'SELECT * FROM shelly_readings WHERE inverter_name = ? ORDER BY created_at DESC LIMIT 1'
    ).get(inv.name) ?? null;
    shellyConsumptionTodayByInv[inv.name] = db.prepare(`
      SELECT ROUND(SUM(CASE WHEN total_act_power > 0 THEN total_act_power ELSE 0 END) * ? / 60.0, 1) AS wh
      FROM shelly_readings
      WHERE inverter_name = ?
        AND date(datetime(created_at, '+' || ? || ' hours')) = ?
    `).get(syncMin, inv.name, tzHours, today)?.wh ?? null;
  }

  return { inverters, summary, liveData, settings, today, todaySavings, todaySavingsProfile,
           todaySavingsPowerbank, hasProfile, ankerChargeToday, ankerDischargeToday,
           shellyLiveByInv, shellyConsumptionTodayByInv, cumulKwhFromApril };
}
