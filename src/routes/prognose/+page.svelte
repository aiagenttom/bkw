<script>
  import { onMount, tick } from 'svelte';
  export let data;

  const dayNames = ['Mo','Di','Mi','Do','Fr','Sa','So'];

  // Reactive – all variables update on SvelteKit navigation (query param changes)
  let targetDate, today, tomorrow, minDate, maxDate, prices, weather, predictions;
  let currentHour, mwstPct, netzCt, priceMode, fixedPriceCt, timezone, weekday;
  $: ({ targetDate, today, tomorrow, minDate, maxDate, prices, weather, predictions,
        currentHour, mwstPct, netzCt, priceMode, fixedPriceCt, timezone, weekday } = data);

  $: pricesAvailable = prices.length > 0;
  $: weatherAvailable = weather && weather.hourly && weather.hourly.length > 0;

  // Totals
  $: totalKwp = predictions.reduce((s, p) => s + (p.kwp || 0), 0);
  $: totalYield = predictions.filter(p => p.yieldKwh != null).reduce((s, p) => s + p.yieldKwh, 0);
  $: totalSavings = predictions.filter(p => p.savingsEur != null).reduce((s, p) => s + p.savingsEur, 0);
  $: hasAnyProfile = predictions.some(p => p.hasProfile);
  $: totalEigenverbrauch = predictions.filter(p => p.eigenverbrauchKwh != null).reduce((s, p) => s + p.eigenverbrauchKwh, 0);
  $: totalEinspeisung = predictions.filter(p => p.einspeisungKwh != null).reduce((s, p) => s + p.einspeisungKwh, 0);

  // Weather daily summary
  $: daily = weather?.daily;
  $: solarWeather = weather?.hourly?.filter(h => h.hour >= 5 && h.hour <= 21) || [];
  $: avgCloud = solarWeather.length ? Math.round(solarWeather.reduce((s, h) => s + h.cloudCover, 0) / solarWeather.length) : null;
  $: maxGhi = solarWeather.length ? Math.round(Math.max(...solarWeather.map(h => h.ghi))) : null;

  // Date navigation
  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().substring(0, 10);
  }

  $: prevDate = targetDate ? addDays(targetDate, -1) : null;
  $: nextDate = targetDate ? addDays(targetDate, +1) : null;
  $: canGoPrev = prevDate && minDate && prevDate >= minDate;
  $: canGoNext = nextDate && maxDate && nextDate <= maxDate;

  function dateLabel(dateStr) {
    if (dateStr === today) return 'Heute';
    if (dateStr === tomorrow) return 'Morgen';
    return formatDate(dateStr);
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function dateHref(dateStr) {
    return `/prognose?date=${dateStr}`;
  }

  // Spot prices badge message
  $: pricesBadgeMsg = targetDate <= tomorrow ? 'ab ~14 Uhr verfügbar' : 'nicht verfügbar';

  // Charts – destroy and rebuild whenever data changes
  let ChartClass;
  let priceChartInst = null;
  let weatherChartInst = null;

  onMount(async () => {
    const mod = await import('chart.js/auto');
    ChartClass = mod.default || mod.Chart;
  });

  // Rebuild when data or ChartClass changes
  $: if (ChartClass) {
    // Reference data properties to create reactive dependency
    void prices; void weather;
    tick().then(buildCharts);
  }

  function buildCharts() {
    if (priceChartInst) { priceChartInst.destroy(); priceChartInst = null; }
    if (weatherChartInst) { weatherChartInst.destroy(); weatherChartInst = null; }
    buildPriceChart();
    buildWeatherChart();
  }

  function buildPriceChart() {
    if (!pricesAvailable) return;
    const canvas = document.getElementById('price-chart');
    if (!canvas) return;

    const filteredPrices = prices.filter(p => p.hour >= 4 && p.hour <= 22);
    const labels = filteredPrices.map(p => `${String(p.hour).padStart(2,'0')}:00`);
    const values = filteredPrices.map(p => parseFloat(((p.avg_price + netzCt) * (1 + mwstPct / 100)).toFixed(3)));

    priceChartInst = new ChartClass(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: `Spotpreis inkl. Netzgeb. + ${mwstPct}% MwSt (ct/kWh)`,
          data: values,
          borderColor: '#f39c12',
          backgroundColor: 'rgba(243,156,18,0.15)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true, position: 'top' } },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'ct/kWh' } }
        }
      }
    });
  }

  function buildWeatherChart() {
    if (!weatherAvailable) return;
    const canvas = document.getElementById('weather-chart');
    if (!canvas) return;

    const solarHours = weather.hourly.filter(h => h.hour >= 4 && h.hour <= 22);
    const labels = solarHours.map(h => `${String(h.hour).padStart(2,'0')}:00`);

    weatherChartInst = new ChartClass(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Globalstrahlung (W/m²)',
            data: solarHours.map(h => h.ghi),
            backgroundColor: 'rgba(241,196,15,0.6)',
            borderColor: '#f1c40f',
            borderWidth: 1,
            yAxisID: 'y',
            order: 2,
          },
          {
            label: 'Bewölkung (%)',
            data: solarHours.map(h => h.cloudCover),
            type: 'line',
            borderColor: '#95a5a6',
            backgroundColor: 'rgba(149,165,166,0.2)',
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            yAxisID: 'y1',
            order: 1,
          },
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true, position: 'top' } },
        scales: {
          y:  { beginAtZero: true, title: { display: true, text: 'W/m²' }, position: 'left' },
          y1: { beginAtZero: true, max: 100, title: { display: true, text: 'Bewölkung %' }, position: 'right', grid: { drawOnChartArea: false } },
        }
      }
    });
  }
</script>

<svelte:head><title>Prognose – BKW</title></svelte:head>

<!-- Header -->
<div class="d-flex justify-content-between align-items-center mb-3">
  <h4 class="fw-bold mb-0"><i class="bi bi-cloud-sun me-2"></i>Prognose</h4>
</div>

<!-- Date navigation -->
<div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
  {#if canGoPrev}
    <a href={dateHref(prevDate)} class="btn btn-outline-secondary btn-sm">
      <i class="bi bi-chevron-left"></i>
    </a>
  {:else}
    <button class="btn btn-outline-secondary btn-sm" disabled>
      <i class="bi bi-chevron-left"></i>
    </button>
  {/if}

  <a href={dateHref(today)} class="btn btn-sm {targetDate === today ? 'btn-primary' : 'btn-outline-primary'}">Heute</a>
  <a href={dateHref(tomorrow)} class="btn btn-sm {targetDate === tomorrow ? 'btn-primary' : 'btn-outline-primary'}">Morgen</a>

  <span class="fw-semibold text-body ms-1">{formatDate(targetDate)}</span>

  {#if canGoNext}
    <a href={dateHref(nextDate)} class="btn btn-outline-secondary btn-sm ms-auto">
      <i class="bi bi-chevron-right"></i>
    </a>
  {:else}
    <button class="btn btn-outline-secondary btn-sm ms-auto" disabled>
      <i class="bi bi-chevron-right"></i>
    </button>
  {/if}
</div>

<!-- Status badges -->
<div class="d-flex gap-2 mb-3 flex-wrap">
  {#if pricesAvailable}
    <span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>Spotpreise verfügbar ({prices.length}h)</span>
  {:else}
    <span class="badge bg-warning text-dark"><i class="bi bi-clock me-1"></i>Spotpreise {pricesBadgeMsg}</span>
  {/if}
  {#if weatherAvailable}
    <span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>Wetterdaten geladen</span>
  {:else if targetDate <= maxDate}
    <span class="badge bg-danger"><i class="bi bi-x-circle me-1"></i>Wetterdaten nicht verfügbar</span>
  {:else}
    <span class="badge bg-secondary"><i class="bi bi-calendar-x me-1"></i>Kein Wetter-Forecast verfügbar</span>
  {/if}
  <span class="badge bg-secondary"><i class="bi bi-geo-alt me-1"></i>Bezirk Mödling</span>
</div>

<!-- Weather summary card -->
{#if weatherAvailable && daily}
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold"><i class="bi bi-cloud-sun me-2"></i>Wetter Zusammenfassung</div>
  <div class="card-body">
    <div class="row text-center">
      <div class="col-6 col-md-3 mb-2">
        <div class="text-muted small">Sonnenstunden</div>
        <div class="fs-4 fw-bold text-warning">{daily.sunshineDurationH}h</div>
      </div>
      <div class="col-6 col-md-3 mb-2">
        <div class="text-muted small">Ø Bewölkung (5–21h)</div>
        <div class="fs-4 fw-bold" class:text-success={avgCloud < 40} class:text-warning={avgCloud >= 40 && avgCloud < 70} class:text-danger={avgCloud >= 70}>{avgCloud}%</div>
      </div>
      <div class="col-6 col-md-3 mb-2">
        <div class="text-muted small">Max. Strahlung</div>
        <div class="fs-4 fw-bold text-warning">{maxGhi} W/m²</div>
      </div>
      <div class="col-6 col-md-3 mb-2">
        <div class="text-muted small">Temperatur</div>
        <div class="fs-4 fw-bold">{daily.tempMin != null ? `${Math.round(daily.tempMin)}° / ${Math.round(daily.tempMax)}°` : '–'}</div>
      </div>
    </div>
  </div>
</div>
{/if}

<!-- Yield prediction table -->
{#if weatherAvailable}
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold d-flex justify-content-between">
    <span><i class="bi bi-lightning me-2"></i>Ertragsprognose</span>
    {#if hasAnyProfile}
      <span class="badge bg-info text-dark"><i class="bi bi-bar-chart-steps me-1"></i>Verbrauchsprofil: {dayNames[weekday]}</span>
    {/if}
  </div>
  <div class="card-body p-0">
    <div class="table-responsive">
    <table class="table table-sm table-hover mb-0">
      <thead class="table-dark">
        <tr>
          <th>Inverter</th>
          <th class="text-end">kWp</th>
          <th class="text-end">Ertrag</th>
          {#if hasAnyProfile}
            <th class="text-end">Eigenverbr.</th>
            <th class="text-end">Einspeisung</th>
          {/if}
          <th class="text-end">Ersparnis</th>
        </tr>
      </thead>
      <tbody>
        {#each predictions as p}
        <tr>
          <td><span class="d-inline-block rounded-circle me-2" style="width:12px;height:12px;background:{p.color}"></span>{p.name}</td>
          <td class="text-end">{p.kwp > 0 ? p.kwp.toFixed(2) : '–'}</td>
          <td class="text-end fw-bold">{p.yieldKwh != null ? `${p.yieldKwh.toFixed(1)} kWh` : '–'}</td>
          {#if hasAnyProfile}
            <td class="text-end text-primary">{p.eigenverbrauchKwh != null ? `${p.eigenverbrauchKwh.toFixed(1)} kWh` : '–'}</td>
            <td class="text-end text-muted">{p.einspeisungKwh != null ? `${p.einspeisungKwh.toFixed(1)} kWh` : '–'}</td>
          {/if}
          <td class="text-end fw-bold text-success">{p.savingsEur != null ? `€ ${p.savingsEur.toFixed(2)}` : '–'}</td>
        </tr>
        {/each}
        <tr class="table-secondary fw-bold">
          <td>Gesamt</td>
          <td class="text-end">{totalKwp.toFixed(2)}</td>
          <td class="text-end">{totalYield.toFixed(1)} kWh</td>
          {#if hasAnyProfile}
            <td class="text-end text-primary">{totalEigenverbrauch.toFixed(1)} kWh</td>
            <td class="text-end text-muted">{totalEinspeisung.toFixed(1)} kWh</td>
          {/if}
          <td class="text-end text-success">€ {totalSavings.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>
    </div>
  </div>
</div>
{#if !hasAnyProfile}
<div class="alert alert-info py-2 small mb-4">
  <i class="bi bi-info-circle me-1"></i>
  Kein Verbrauchsprofil hinterlegt — Ersparnis wird bei 100% Nutzung berechnet.
  <a href="/admin/usage-profile">Verbrauchsprofil anlegen →</a>
</div>
{/if}
{/if}

{#if !weatherAvailable && predictions.every(p => p.kwp <= 0)}
<div class="alert alert-info">
  <i class="bi bi-info-circle me-2"></i>Bitte kWp-Werte in <a href="/admin/inverters">Admin → Inverters</a> eintragen, um die Ertragsprognose zu berechnen.
</div>
{/if}

<!-- Charts -->
<div class="row g-4 mb-4">
  {#if pricesAvailable}
  <div class="col-12 col-lg-6">
    <div class="card shadow-sm">
      <div class="card-header fw-semibold"><i class="bi bi-currency-euro me-2"></i>Spotpreis {dateLabel(targetDate)}</div>
      <div class="card-body">
        <canvas id="price-chart"></canvas>
      </div>
    </div>
  </div>
  {/if}

  {#if weatherAvailable}
  <div class="col-12 {pricesAvailable ? 'col-lg-6' : ''}">
    <div class="card shadow-sm">
      <div class="card-header fw-semibold"><i class="bi bi-sun me-2"></i>Solarstrahlung & Bewölkung</div>
      <div class="card-body">
        <canvas id="weather-chart"></canvas>
      </div>
    </div>
  </div>
  {/if}
</div>

<!-- Market insight -->
{#if pricesAvailable}
{@const avgPrice = prices.reduce((s, p) => s + p.avg_price, 0) / prices.length}
{@const solarPrices = prices.filter(p => p.hour >= 8 && p.hour <= 16)}
{@const avgSolarPrice = solarPrices.length ? solarPrices.reduce((s, p) => s + p.avg_price, 0) / solarPrices.length : null}
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold"><i class="bi bi-graph-down me-2"></i>Markt-Einschätzung</div>
  <div class="card-body">
    <div class="row">
      <div class="col-6 col-md-3 text-center mb-2">
        <div class="text-muted small">Ø Spotpreis (ganztags)</div>
        <div class="fs-5 fw-bold">{avgPrice.toFixed(1)} ct/kWh</div>
      </div>
      {#if avgSolarPrice != null}
      <div class="col-6 col-md-3 text-center mb-2">
        <div class="text-muted small">Ø Spotpreis (8–16h)</div>
        <div class="fs-5 fw-bold">{avgSolarPrice.toFixed(1)} ct/kWh</div>
      </div>
      {/if}
      <div class="col-12 col-md-6 mb-2">
        <div class="text-muted small mb-1">Bedeutung</div>
        {#if avgSolarPrice != null && avgSolarPrice < 5}
          <span class="badge bg-success">Sehr niedrig → Viel Wind-/Solarenergie im Netz erwartet</span>
        {:else if avgSolarPrice != null && avgSolarPrice < 10}
          <span class="badge bg-info text-dark">Niedrig → Gutes Angebot an erneuerbarer Energie</span>
        {:else if avgSolarPrice != null && avgSolarPrice < 20}
          <span class="badge bg-warning text-dark">Mittel → Normales Preisniveau</span>
        {:else}
          <span class="badge bg-danger">Hoch → Wenig erneuerbare Energie verfügbar</span>
        {/if}
      </div>
    </div>
  </div>
</div>
{/if}

<div class="text-muted small mt-3">
  <i class="bi bi-info-circle me-1"></i>
  Prognose basiert auf Open-Meteo Wetterdaten (Bezirk Mödling) und EPEX Spot-Marktpreisen.
  Performance-Ratio: 80%. Ergebnisse sind Schätzwerte.
</div>
