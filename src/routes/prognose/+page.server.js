import db from '$lib/db.js';
import { getTzOffset, getTimezone } from '$lib/tz.js';

function getSetting(key) {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value;
}

/** Get date string offset by `days` from now in local timezone */
function getLocalDate(offsetDays = 0) {
  const tz = getTimezone();
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${day}`;
}

export async function load({ url }) {
  const tz = getTimezone();
  const today = getLocalDate(0);
  const tomorrow = getLocalDate(1);
  const maxDate = getLocalDate(6); // today + 6 days (Open-Meteo forecast limit)

  // Earliest date with spot prices in DB
  const todayOffset = getTzOffset(today);
  const minPriceRow = db.prepare(
    `SELECT MIN(date(datetime(ts, '+' || ? || ' hours'))) as d FROM spotty_prices`
  ).get(todayOffset);
  const minDate = minPriceRow?.d || today;

  // Get requested date from query param, default to tomorrow
  let targetDate = url.searchParams.get('date') || tomorrow;

  // Clamp to valid range
  if (targetDate < minDate) targetDate = minDate;
  if (targetDate > maxDate) targetDate = maxDate;

  const tzOffset = getTzOffset(targetDate);

  // --- 1) Spot prices for target date (hourly averages) ---
  const prices = db.prepare(`
    SELECT
      CAST(strftime('%H', datetime(ts, '+' || ? || ' hours')) AS INTEGER) AS hour,
      ROUND(AVG(price), 3) AS avg_price
    FROM spotty_prices
    WHERE date(datetime(ts, '+' || ? || ' hours')) = ?
    GROUP BY hour
    ORDER BY hour
  `).all(tzOffset, tzOffset, targetDate);

  // --- 2) Inverters with kWp ---
  const inverters = db.prepare('SELECT id, name, color, kwp, enabled FROM inverters WHERE enabled = 1 ORDER BY name').all();

  // --- 3) Settings ---
  const mwstPct = parseFloat(getSetting('mwst_percent') || '0');
  const netzCt  = parseFloat(getSetting('netzgebuehr_ct') || '0');
  const priceMode = getSetting('price_mode') || 'fixed';
  const fixedPriceCt = parseFloat(getSetting('fixed_price_ct') || '30');

  // --- 4) Fetch weather from Open-Meteo (7-day forecast) ---
  let weather = null;
  try {
    const weatherUrl = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=48.08&longitude=16.28'
      + '&hourly=shortwave_radiation,direct_radiation,cloud_cover,temperature_2m,windspeed_10m'
      + '&daily=sunshine_duration,shortwave_radiation_sum,temperature_2m_max,temperature_2m_min'
      + '&forecast_days=7'
      + '&timezone=' + encodeURIComponent(tz);

    const resp = await fetch(weatherUrl, { signal: AbortSignal.timeout(8000) });
    if (resp.ok) {
      const data = await resp.json();

      const targetIdx = data.daily?.time?.indexOf(targetDate) ?? -1;

      const hourlyTarget = [];
      if (data.hourly?.time) {
        for (let i = 0; i < data.hourly.time.length; i++) {
          if (data.hourly.time[i].startsWith(targetDate)) {
            hourlyTarget.push({
              hour: parseInt(data.hourly.time[i].substring(11, 13)),
              ghi: data.hourly.shortwave_radiation?.[i] ?? 0,
              directRadiation: data.hourly.direct_radiation?.[i] ?? 0,
              cloudCover: data.hourly.cloud_cover?.[i] ?? 0,
              temperature: data.hourly.temperature_2m?.[i] ?? 0,
              windSpeed: data.hourly.windspeed_10m?.[i] ?? 0,
            });
          }
        }
      }

      const dailySummary = targetIdx >= 0 ? {
        sunshineDurationH: Math.round((data.daily.sunshine_duration?.[targetIdx] ?? 0) / 3600 * 10) / 10,
        radiationSum: data.daily.shortwave_radiation_sum?.[targetIdx] ?? 0,
        tempMax: data.daily.temperature_2m_max?.[targetIdx] ?? null,
        tempMin: data.daily.temperature_2m_min?.[targetIdx] ?? null,
      } : null;

      weather = { hourly: hourlyTarget, daily: dailySummary };
    }
  } catch (e) {
    console.warn('[prognose] weather fetch failed:', e.message);
  }

  // --- 5) Usage profiles for target date's weekday ---
  const targetDateObj = new Date(targetDate + 'T12:00:00');
  const jsDay = targetDateObj.getDay(); // 0=Sun
  const weekday = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon,...,6=Sun

  const usageRows = db.prepare('SELECT inverter_id, hour, kw FROM usage_profiles WHERE weekday = ?').all(weekday);
  const usageByInverter = {};
  for (const r of usageRows) {
    if (!usageByInverter[r.inverter_id]) usageByInverter[r.inverter_id] = new Array(24).fill(0);
    usageByInverter[r.inverter_id][r.hour] = r.kw;
  }

  // --- 6) Calculate predictions with Eigenverbrauch ---
  const performanceRatio = 0.80;
  const predictions = [];

  for (const inv of inverters) {
    if (!inv.kwp || inv.kwp <= 0) {
      predictions.push({ name: inv.name, color: inv.color, kwp: inv.kwp || 0, yieldKwh: null, savingsEur: null, eigenverbrauchKwh: null, einspeisungKwh: null });
      continue;
    }

    let totalYieldWh = 0;
    let totalEigenverbrauchWh = 0;
    let totalSavingsEur = 0;
    const usageProfile = usageByInverter[inv.id];
    const hasProfile = usageProfile && usageProfile.some(v => v > 0);

    const solarHours = weather?.hourly?.filter(h => h.hour >= 5 && h.hour <= 21) || [];
    for (const h of solarHours) {
      const yieldWh = h.ghi * inv.kwp * performanceRatio;
      totalYieldWh += yieldWh;

      const usageWh = hasProfile ? usageProfile[h.hour] * 1000 : yieldWh;
      const eigenverbrauchWh = Math.min(yieldWh, usageWh);
      totalEigenverbrauchWh += eigenverbrauchWh;

      const priceCt = prices.find(p => p.hour === h.hour)?.avg_price ?? (priceMode === 'spotty' ? null : fixedPriceCt);
      if (priceCt != null) {
        const totalCtPerKwh = (priceCt + netzCt) * (1 + mwstPct / 100);
        totalSavingsEur += (eigenverbrauchWh / 1000) * totalCtPerKwh / 100;
      }
    }

    const yieldKwh = Math.round(totalYieldWh / 1000 * 100) / 100;
    const eigenverbrauchKwh = Math.round(totalEigenverbrauchWh / 1000 * 100) / 100;

    predictions.push({
      name: inv.name,
      color: inv.color,
      kwp: inv.kwp,
      yieldKwh,
      eigenverbrauchKwh: hasProfile ? eigenverbrauchKwh : null,
      einspeisungKwh: hasProfile ? Math.round((yieldKwh - eigenverbrauchKwh) * 100) / 100 : null,
      savingsEur: Math.round(totalSavingsEur * 100) / 100,
      hasProfile,
    });
  }

  // --- 7) Current hour ---
  const nowParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', hour12: false
  }).formatToParts(new Date());
  const currentHour = parseInt(nowParts.find(p => p.type === 'hour')?.value ?? '0');

  return {
    targetDate,
    today,
    tomorrow,
    minDate,
    maxDate,
    prices,
    inverters,
    weather,
    predictions,
    currentHour,
    mwstPct,
    netzCt,
    priceMode,
    fixedPriceCt,
    timezone: tz,
    weekday,
  };
}
