<script>
  import { onMount, onDestroy, tick } from 'svelte';
  export let data;

  const { inverters, summary, settings, today } = data;
  let liveData     = data.liveData;
  let todaySavings = data.todaySavings;
  let selInv    = 'all';
  let selDate   = today;
  let lastUpdate = '';
  let timer;
  let summaryData = data.summary;

  // Dynamic colors from DB (with alpha variant for chart fill)
  function hexToRgba(hex, alpha = 0.15) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const COLORS = Object.fromEntries(
    inverters.map(inv => [inv.name, {
      border: inv.color || '#888',
      bg:     hexToRgba(inv.color || '#888888'),
    }])
  );

  // Filtered inverter list for display
  $: visibleInverters = selInv === 'all' ? inverters       : inverters.filter(i => i.name === selInv);
  $: visibleSummary   = selInv === 'all' ? summaryData : summaryData.filter(s => s.name === selInv);

  let charts = {};
  let ChartClass; // set in onMount, used by fetchData for lazy price chart

  onMount(async () => {
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);
    ChartClass = Chart;

    const opts = (ylabel, beginZero = true) => ({
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { title: items => items[0]?.label?.substring(11,16) || '' } },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 12, callback(v) { return this.getLabelForValue(v)?.substring(11,16)||''; } } },
        y: { beginAtZero: beginZero, title: { display: true, text: ylabel, font: { size: 11 } } },
      },
    });

    charts.power   = new Chart(document.getElementById('cPower'),   { type: 'line', data: { labels: [], datasets: [] }, options: opts('Watts (W)') });
    charts.temp    = new Chart(document.getElementById('cTemp'),    { type: 'line', data: { labels: [], datasets: [] }, options: opts('°C', false) });
    charts.current = new Chart(document.getElementById('cCurrent'), { type: 'line', data: { labels: [], datasets: [] }, options: opts('Ampere (A)') });
    charts.voltage = new Chart(document.getElementById('cVoltage'), { type: 'line', data: { labels: [], datasets: [] }, options: opts('Voltage (V)', false) });

    await fetchData();
    const secs = parseInt(settings.auto_refresh_s || 30);
    if (secs > 0) timer = setInterval(fetchData, secs * 1000);
  });

  onDestroy(() => { clearInterval(timer); Object.values(charts).forEach(c => c?.destroy()); });

  async function fetchData() {
    try {
      const resp = await fetch(`/api/chart-data?name=${encodeURIComponent(selInv)}&date=${selDate}`);
      const json = await resp.json();
      if (!json.success) return;

      const g = json.data;
      const names = Object.keys(g);
      // Convert UTC log_time to local time for display (DST-aware)
      const tz = settings.timezone || 'Europe/Vienna';
      const labels = (g[names[0]] || []).map(r => {
        const d = new Date(r.log_time.replace(' ', 'T') + 'Z');
        const parts = new Intl.DateTimeFormat('sv-SE', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        }).formatToParts(d);
        const v = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
        return `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`;
      });

      const ptRadius = labels.length > 60 ? 0 : 2;

      const ds = (key, fill = true) => names.map(n => ({
        label: n, fill,
        data: (g[n]||[]).map(r => r[key]),
        borderColor: COLORS[n]?.border || '#888',
        backgroundColor: fill ? (COLORS[n]?.bg || 'rgba(0,0,0,.1)') : 'transparent',
        borderWidth: 2, pointRadius: ptRadius, tension: 0.3,
      }));

      // Build per-MPPT-string datasets for power & current charts
      // Each inverter with dc_strings gets separate lines per string + a total line
      const dsDcPower = [];
      const dsDcCurrent = [];
      for (const n of names) {
        const rows = g[n] || [];
        const color = COLORS[n]?.border || '#888';
        // Show per-string lines when at least 3 rows have dc_strings data
        const dcCount = rows.filter(r => r.dc_strings).length;
        const hasDcStrings = dcCount >= 3;
        if (hasDcStrings) {
          // Parse dc_strings from first row that has it to get string names
          const sample = JSON.parse(rows.find(r => r.dc_strings)?.dc_strings || '[]');
          // Per-string lines (use distinct dash patterns per string)
          const dashPatterns = [[6, 3], [2, 2], [8, 4, 2, 4]];
          sample.forEach((s, idx) => {
            dsDcPower.push({
              label: `${n} – ${s.name}`, fill: false, spanGaps: true,
              data: rows.map(r => { const arr = r.dc_strings ? JSON.parse(r.dc_strings) : []; return arr[idx]?.power ?? null; }),
              borderColor: COLORS[n]?.border || '#888',
              borderDash: dashPatterns[idx % dashPatterns.length],
              borderWidth: 1.5, pointRadius: ptRadius, tension: 0.3,
              backgroundColor: 'transparent',
            });
            dsDcCurrent.push({
              label: `${n} – ${s.name}`, fill: false, spanGaps: true,
              data: rows.map(r => { const arr = r.dc_strings ? JSON.parse(r.dc_strings) : []; return arr[idx]?.current ?? null; }),
              borderColor: COLORS[n]?.border || '#888',
              borderDash: dashPatterns[idx % dashPatterns.length],
              borderWidth: 1.5, pointRadius: ptRadius, tension: 0.3,
              backgroundColor: 'transparent',
            });
          });
          // Total line (solid)
          dsDcPower.push({
            label: `${n} (Gesamt)`, fill: true,
            data: rows.map(r => r.power_dc_v),
            borderColor: color, backgroundColor: COLORS[n]?.bg || 'rgba(0,0,0,.1)',
            borderWidth: 2, pointRadius: ptRadius, tension: 0.3,
          });
          dsDcCurrent.push({
            label: `${n} (Gesamt)`, fill: false,
            data: rows.map(r => r.current_v),
            borderColor: color, backgroundColor: 'transparent',
            borderWidth: 2, pointRadius: ptRadius, tension: 0.3,
          });
        } else {
          // Not enough DC string data — single line
          dsDcPower.push({
            label: n, fill: true,
            data: rows.map(r => r.power_dc_v),
            borderColor: color, backgroundColor: COLORS[n]?.bg || 'rgba(0,0,0,.1)',
            borderWidth: 2, pointRadius: ptRadius, tension: 0.3,
          });
          dsDcCurrent.push({
            label: n, fill: false,
            data: rows.map(r => r.current_v),
            borderColor: color, backgroundColor: 'transparent',
            borderWidth: 2, pointRadius: ptRadius, tension: 0.3,
          });
        }
      }

      if (charts.power)   { charts.power.data   = { labels, datasets: dsDcPower };                charts.power.update('none'); }
      if (charts.temp)     { charts.temp.data    = { labels, datasets: ds('temperature_v', false) }; charts.temp.update('none'); }
      if (charts.current)  { charts.current.data = { labels, datasets: dsDcCurrent };               charts.current.update('none'); }
      if (charts.voltage)  { charts.voltage.data = { labels, datasets: ds('voltage_ac_v', false) }; charts.voltage.update('none'); }
      lastUpdate = 'Updated ' + new Date().toLocaleTimeString();

      // Recompute summary stats from fetched data (so they update when date changes)
      summaryData = names.map(n => {
        const rows = g[n] || [];
        const powers = rows.map(r => r.power_dc_v).filter(v => v != null);
        return {
          name: n,
          peak_power: powers.length ? parseFloat(Math.max(...powers).toFixed(1)) : null,
          avg_power:  powers.length ? parseFloat((powers.reduce((a,b) => a+b, 0) / powers.length).toFixed(1)) : null,
        };
      });

      // Refresh live data + savings
      const live = await fetch('/api/live');
      const lj = await live.json();
      if (lj.success) liveData = lj.data;

      // Re-fetch savings from server (lightweight endpoint)
      const savR = await fetch('/api/today-savings');
      const savJ = await savR.json();
      if (savJ.success) todaySavings = savJ.data;

      // Spotty price curve for selected day (filtered to 04:30–22:30, incl. MwSt + Netzgebühr)
      const priceR = await fetch(`/api/prices?date=${selDate}`);
      const priceJ = await priceR.json();
      // Filter to hours 4–22 (matching the 04:30–22:30 solar window)
      const priceData = (priceJ.data || []).filter(r => r.hour >= 4 && r.hour <= 22);
      if (priceJ.success && priceData.length) {
        showPriceChart = true;
        await tick(); // ensure cPrice canvas is visible before Chart.js init

        // Apply MwSt + Netzgebühr to spot prices
        const mwstPct = parseFloat(settings.mwst_percent ?? '0');
        const netzCt  = parseFloat(settings.netzgebuehr_ct ?? '0');
        const applyTaxes = (ct) => parseFloat(((ct + netzCt) * (1 + mwstPct / 100)).toFixed(3));

        if (!charts.price && ChartClass) {
          const priceOpts = {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
              tooltip: { callbacks: { title: items => items[0]?.label + ':00' || '' } },
            },
            scales: {
              x: { ticks: { callback(v) { return this.getLabelForValue(v) + ':00'; } } },
              y: { beginAtZero: false, title: { display: true, text: 'ct/kWh', font: { size: 11 } } },
            },
          };
          charts.price = new ChartClass(document.getElementById('cPrice'), {
            type: 'line', data: { labels: [], datasets: [] }, options: priceOpts,
          });
        }
        if (charts.price) {
          const priceLabels = priceData.map(r => String(r.hour).padStart(2, '0'));
          charts.price.data = {
            labels: priceLabels,
            datasets: [{
              label: `Ø Spotpreis inkl. Netzgeb. + ${mwstPct}% MwSt (ct/kWh)`,
              data: priceData.map(r => applyTaxes(r.avg_price)),
              borderColor: '#f39c12',
              backgroundColor: 'rgba(243,156,18,0.1)',
              borderWidth: 2, pointRadius: 3, tension: 0.3, fill: true,
            }],
          };
          charts.price.update('none');
        }
      } else {
        showPriceChart = false;
      }
    } catch (err) {
      console.error('[dashboard] fetchData error:', err);
      lastUpdate = 'Error: ' + err.message;
    }
  }

  let showPriceChart = false;

  function fmt(v, d = 1) { return v != null ? v.toFixed(d) : '–'; }

  /** Convert UTC datetime string to local time display (HH:MM:SS) */
  function toLocalTime(utcStr) {
    if (!utcStr) return '';
    const tz = settings.timezone || 'Europe/Vienna';
    const d = new Date(utcStr.replace(' ', 'T') + (utcStr.includes('Z') ? '' : 'Z'));
    return d.toLocaleTimeString('de-AT', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
</script>

<svelte:head>
  <title>BKW Dashboard</title>
</svelte:head>

<!-- Header -->
<div class="d-flex flex-wrap align-items-center justify-content-between mb-3 gap-2">
  <div>
    <h4 class="mb-0 fw-bold"><i class="bi bi-sun-fill text-warning me-2"></i>BKW Solar Dashboard</h4>
    <small class="text-muted">Live solar power monitoring</small>
  </div>
  <div class="d-flex gap-2 align-items-center flex-wrap">
    <select bind:value={selInv} on:change={fetchData} class="form-select form-select-sm" style="width:140px">
      <option value="all">All Inverters</option>
      {#each inverters as inv}<option value={inv.name}>{inv.name}</option>{/each}
    </select>
    <input type="date" bind:value={selDate} on:change={fetchData}
           class="form-control form-control-sm" style="width:160px" max={today} />
    <button class="btn btn-warning btn-sm" on:click={fetchData}>
      <i class="bi bi-arrow-clockwise me-1"></i>Refresh
    </button>
    <span class="badge bg-secondary">{lastUpdate}</span>
  </div>
</div>

<!-- Live cards -->
<div class="row g-3 mb-4">
  {#each visibleInverters as inv}
  {@const d = liveData[inv.name] ?? {}}
  {@const sav = todaySavings[inv.name]}
  {@const effectiveMode = inv.price_mode || settings.price_mode || 'fixed'}
  {@const effectiveFixed = inv.fixed_price_ct ?? settings.fixed_price_ct ?? 30}
  <div class="col-sm-6 col-xl-4">
    <div class="card h-100 bkw-live-card shadow-sm">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <h6 class="card-title mb-0 fw-bold">
            <i class="bi bi-lightning-fill me-1" style="color:{inv.color}"></i>{inv.name}
          </h6>
          <span class="badge" class:bg-success={d.reachable} class:bg-danger={!d.reachable}>
            {d.reachable ? 'Online' : 'Offline'}
          </span>
        </div>
        <div class="row row-cols-2 g-1">
          <div class="col text-center bkw-stat-box">
            <div class="fs-5 fw-bold text-warning">{fmt(d.power_ac, 0)}</div>
            <div class="text-muted small">W AC</div>
          </div>
          <div class="col text-center bkw-stat-box">
            <div class="fs-5 fw-bold text-info">{fmt(d.power_dc, 0)}</div>
            <div class="text-muted small">W DC</div>
          </div>
          <div class="col text-center bkw-stat-box">
            <div class="fw-bold">{fmt(d.temperature)}°C</div>
            <div class="text-muted small">Temp</div>
          </div>
          <div class="col text-center bkw-stat-box">
            <div class="fw-bold">{fmt(d.yield_day, 2)}</div>
            <div class="text-muted small">Wh today</div>
          </div>
        </div>
        <!-- Savings row -->
        <div class="mt-2 pt-2 border-top d-flex justify-content-between align-items-center">
          <small class="text-muted">
            <i class="bi bi-currency-euro me-1"></i>Ersparnis bei 100% Nutzung
            {#if effectiveMode === 'spotty'}
              <span class="badge bg-primary ms-1" style="font-size:.65rem">⚡ Spot</span>
            {:else}
              <span class="badge bg-secondary ms-1" style="font-size:.65rem">🔒 {effectiveFixed} ct</span>
            {/if}
          </small>
          <span class="fw-bold text-success">
            {sav != null ? '€\u202f' + sav.toFixed(2) : '–'}
          </span>
        </div>
        {#if d.synced_at}
          <div class="text-muted mt-1" style="font-size:.7rem">Synced: {toLocalTime(d.synced_at)}</div>
        {/if}
      </div>
    </div>
  </div>
  {/each}
</div>

<!-- Summary stats -->
<div class="row g-3 mb-4">
  {#each visibleSummary as s}
  <div class="col-6 col-md-3">
    <div class="card text-center shadow-sm border-0">
      <div class="card-body py-2">
        <div class="text-muted small">{s.name} – Peak</div>
        <div class="fs-5 fw-bold text-warning">{s.peak_power ?? '–'} W</div>
      </div>
    </div>
  </div>
  <div class="col-6 col-md-3">
    <div class="card text-center shadow-sm border-0">
      <div class="card-body py-2">
        <div class="text-muted small">{s.name} – Avg</div>
        <div class="fs-5 fw-bold text-info">{s.avg_power ?? '–'} W</div>
      </div>
    </div>
  </div>
  {/each}
</div>

<!-- Charts -->
<div class="row g-3 mb-4">
  <div class="col-12 col-xl-8">
    <div class="card shadow-sm">
      <div class="card-header fw-semibold">
        <i class="bi bi-graph-up-arrow text-warning me-2"></i>Power Output (W DC)
      </div>
      <div class="card-body" style="min-height:280px">
        <canvas id="cPower" style="max-height:280px"></canvas>
      </div>
    </div>
  </div>
  <div class="col-12 col-xl-4">
    <div class="card shadow-sm">
      <div class="card-header fw-semibold">
        <i class="bi bi-thermometer-half text-danger me-2"></i>Temperature (°C)
      </div>
      <div class="card-body" style="min-height:280px">
        <canvas id="cTemp" style="max-height:280px"></canvas>
      </div>
    </div>
  </div>
</div>
<div class="row g-3 mb-4">
  <div class="col-12 col-md-6">
    <div class="card shadow-sm">
      <div class="card-header fw-semibold"><i class="bi bi-activity text-info me-2"></i>Current (A)</div>
      <div class="card-body"><canvas id="cCurrent" style="max-height:240px"></canvas></div>
    </div>
  </div>
  <div class="col-12 col-md-6">
    <div class="card shadow-sm">
      <div class="card-header fw-semibold"><i class="bi bi-plug text-success me-2"></i>AC Voltage (V)</div>
      <div class="card-body"><canvas id="cVoltage" style="max-height:240px"></canvas></div>
    </div>
  </div>
</div>

<!-- Spot price chart (hidden when no data for selected day) -->
<div class="row g-3 mb-4" class:d-none={!showPriceChart}>
  <div class="col-12">
    <div class="card shadow-sm">
      <div class="card-header fw-semibold">
        <i class="bi bi-graph-up text-warning me-2"></i>Spotpreis – stündlicher Ø (inkl. Netzgeb. + MwSt)
        <span class="badge bg-warning text-dark ms-2" style="font-size:.7rem">ct/kWh</span>
      </div>
      <div class="card-body"><canvas id="cPrice" style="max-height:200px"></canvas></div>
    </div>
  </div>
</div>
