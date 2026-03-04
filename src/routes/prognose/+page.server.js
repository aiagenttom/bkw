import db from '$lib/db.js';
import { getTzOffset, getTimezone } from '$lib/tz.js';

function getSetting(key) {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value;
}

/** Get tomorrow's date string in local timezone */
function getLocalTomorrow() {
  const tz = getTimezone();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(tomorrow);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

/** Get today's date string in local timezone */
function getLocalToday() {
  const tz = getTimezone();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

export async function load() {
  const tomorrow = getLocalTomorrow();
  const today = getLocalToday();
  const tz = getTimezone();
  const tzOffset = getTzOffset(tomorrow);

  // --- 1) Spot prices for tomorrow (hourly averages) ---
  const prices = db.prepare(`
    SELECT
      CAST(strftime('%H', datetime(ts, '+' || ? || ' hours')) AS INTEGER) AS hour,
      ROUND(AVG(price), 3) AS avg_price
    FROM spotty_prices
    WHERE date(datetime(ts, '+' || ? || ' hours')) = ?
    GROUP BY hour
    ORDER BY hour
  `).all(tzOffset, tzOffset, tomorrow);

  // --- 2) Inverters with kWp ---
  const inverters = db.prepare('SELECT id, name, color, kwp, enabled FROM inverters WHERE enabled = 1 ORDER BY name').all();

  // --- 3) Settings ---
  const mwstPct = parseFloat(getSetting('mwst_percent') || '0');
  const netzCt  = parseFloat(getSetting('netzgebuehr_ct') || '0');
  const priceMode = getSetting('price_mode') || 'fixed';
  const fixedPriceCt = parseFloat(getSetting('fixed_price_ct') || '30');

  // --- 4) Fetch weather from Open-Meteo (live) ---
  let weather = null;
  try {
    const weatherUrl = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=48.08&longitude=16.28'
      + '&hourly=shortwave_radiation,direct_radiation,cloud_cover,temperature_2m,windspeed_10m'
      + '&daily=sunshine_duration,shortwave_radiation_sum,temperature_2m_max,temperature_2m_min'
      + '&forecast_days=2'
      + '&timezone=' + encodeURIComponent(tz);

    const resp = await fetch(weatherUrl, { signal: AbortSignal.timeout(8000) });
    if (resp.ok) {
      const data = await resp.json();

      // Find tomorrow's index in daily arrays
      const tomorrowIdx = data.daily?.time?.indexOf(tomorrow) ?? -1;

      // Filter hourly data for tomorrow (hours 0-23)
      const hourlyTomorrow = [];
      if (data.hourly?.time) {
        for (let i = 0; i < data.hourly.time.length; i++) {
          if (data.hourly.time[i].startsWith(tomorrow)) {
            hourlyTomorrow.push({
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

      // Daily summary for tomorrow
      const dailySummary = tomorrowIdx >= 0 ? {
        sunshineDurationH: Math.round((data.daily.sunshine_duration?.[tomorrowIdx] ?? 0) / 3600 * 10) / 10,
        radiationSum: data.daily.shortwave_radiation_sum?.[tomorrowIdx] ?? 0,
        tempMax: data.daily.temperature_2m_max?.[tomorrowIdx] ?? null,
        tempMin: data.daily.temperature_2m_min?.[tomorrowIdx] ?? null,
      } : null;

      weather = { hourly: hourlyTomorrow, daily: dailySummary };
    }
  } catch (e) {
    console.warn('[prognose] weather fetch failed:', e.message);
  }

  // --- 5) Calculate predictions ---
  const performanceRatio = 0.80;
  const predictions = [];

  for (const inv of inverters) {
    if (!inv.kwp || inv.kwp <= 0) {
      predictions.push({ name: inv.name, color: inv.color, kwp: inv.kwp || 0, yieldKwh: null, savingsEur: null });
      continue;
    }

    let totalYieldWh = 0;
    let totalSavingsEur = 0;

    // For each solar hour, calculate yield
    const solarHours = weather?.hourly?.filter(h => h.hour >= 5 && h.hour <= 21) || [];
    for (const h of solarHours) {
      // GHI in W/m² → estimated yield for 1 hour
      // Simple model: yield_wh = GHI * kWp * PR * 1h / 1000 (because GHI is per m², kWp ~ 1000W/kWp per 1000 W/m²)
      const yieldWh = h.ghi * inv.kwp * performanceRatio;
      totalYieldWh += yieldWh;

      // Savings for this hour
      const priceCt = prices.find(p => p.hour === h.hour)?.avg_price ?? (priceMode === 'spotty' ? null : fixedPriceCt);
      if (priceCt != null) {
        const totalCtPerKwh = (priceCt + netzCt) * (1 + mwstPct / 100);
        totalSavingsEur += (yieldWh / 1000) * totalCtPerKwh / 100;
      }
    }

    predictions.push({
      name: inv.name,
      color: inv.color,
      kwp: inv.kwp,
      yieldKwh: Math.round(totalYieldWh / 1000 * 100) / 100,
      savingsEur: Math.round(totalSavingsEur * 100) / 100,
    });
  }

  // --- 6) Current hour for "data available" check ---
  const nowParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', hour12: false
  }).formatToParts(new Date());
  const currentHour = parseInt(nowParts.find(p => p.type === 'hour')?.value ?? '0');

  return {
    tomorrow,
    today,
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
  };
}
