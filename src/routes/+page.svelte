<script>
  import { onMount, onDestroy } from 'svelte';
  export let data;

  const { inverters, summary, settings, today } = data;
  let liveData     = data.liveData;
  let todaySavings = data.todaySavings;
  let selInv    = 'all';
  let selDate   = today;
  let lastUpdate = '';
  let timer;

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

  function color(name) {
    return COLORS[name]?.border ?? '#888';
  }

  // Filtered inverter list for display
  $: visibleInverters = selInv === 'all' ? inverters : inverters.filter(i => i.name === selInv);
  $: visibleSummary   = selInv === 'all' ? summary   : summary.filter(s => s.name === selInv);

  let charts = {};

  onMount(async () => {
    const { Chart, registerables } = await import('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js');
    Chart.register(...registerables);

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
    const resp = await fetch(`/api/chart-data?name=${encodeURIComponent(selInv)}&date=${selDate}`);
    const json = await resp.json();
    if (!json.success) return;

    const g = json.data;
    const names = Object.keys(g);
    const labels = (g[names[0]] || []).map(r => r.log_time);

    const ds = (key, fill = true) => names.map(n => ({
      label: n, fill,
      data: (g[n]||[]).map(r => r[key]),
      borderColor: COLORS[n]?.border || '#888',
      backgroundColor: fill ? (COLORS[n]?.bg || 'rgba(0,0,0,.1)') : 'transparent',
      borderWidth: 2, pointRadius: labels.length > 60 ? 0 : 2, tension: 0.3,
    }));

    charts.power.data   = { labels, datasets: ds('power_dc_v') };
    charts.temp.data    = { labels, datasets: ds('temperature_v', false) };
    charts.current.data = { labels, datasets: ds('current_v', false) };
    charts.voltage.data = { labels, datasets: ds('voltage_ac_v', false) };
    Object.values(charts).forEach(c => c.update('none'));

    // History table
    const allRows = names.flatMap(n => g[n] || [])
      .sort((a,b) => b.log_time.localeCompare(a.log_time)).slice(0, 100);
    histRows = allRows;
    lastUpdate = 'Updated ' + new Date().toLocaleTimeString();

    // Refresh live data + savings
    const live = await fetch('/api/live');
    const lj = await live.json();
    if (lj.success) liveData = lj.data;

    // Re-fetch savings from server (lightweight endpoint)
    const savR = await fetch('/api/today-savings');
    const savJ = await savR.json();
    if (savJ.success) todaySavings = savJ.data;
  }

  let histRows = [];

  function fmt(v, d = 1) { return v != null ? v.toFixed(d) : '–'; }
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
          <small class="text-muted"><i class="bi bi-currency-euro me-1"></i>Ersparnis heute</small>
          <span class="fw-bold text-success">
            {sav != null ? '€\u202f' + sav.toFixed(2) : '–'}
          </span>
        </div>
        {#if d.synced_at}
          <div class="text-muted mt-1" style="font-size:.7rem">Synced: {d.synced_at}</div>
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

<!-- History table -->
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold d-flex justify-content-between">
    <span><i class="bi bi-table me-2"></i>Historical Readings</span>
    <small class="text-muted">Last 100 rows</small>
  </div>
  <div class="card-body p-0">
    <div class="table-responsive">
      <table class="table table-sm table-hover mb-0 small">
        <thead class="table-dark">
          <tr>
            <th>Time</th><th>Inverter</th><th>Power DC (W)</th>
            <th>Power AC (W)</th><th>Current (A)</th>
            <th>Temp (°C)</th><th>Voltage AC</th><th>Freq (Hz)</th>
          </tr>
        </thead>
        <tbody>
          {#if histRows.length === 0}
            <tr><td colspan="8" class="text-center text-muted py-3">Loading…</td></tr>
          {:else}
            {#each histRows as r}
            <tr>
              <td class="text-muted">{r.log_time?.substring(11,16) || '–'}</td>
              <td><span class="badge" style="background:{color(r.name)}">{r.name}</span></td>
              <td>{fmt(r.power_dc_v)}</td>
              <td>{fmt(r.power_ac_v)}</td>
              <td>{fmt(r.current_v, 2)}</td>
              <td>{fmt(r.temperature_v)}</td>
              <td>{fmt(r.voltage_ac_v)}</td>
              <td>{fmt(r.frequency_v, 2)}</td>
            </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
