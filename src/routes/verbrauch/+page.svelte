<script>
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';

  export let data;

  let shellInverters = data.shellInverters;
  let byInverter     = data.byInverter;

  let ChartClass  = null;
  let charts      = {};   // inverter name → Chart instance
  let canvases    = {};   // inverter name → canvas element
  let interval;
  let lastUpdated = null;
  let loading     = false;

  function fmt(v, d = 0) { return v != null ? Number(v).toFixed(d) : '–'; }

  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60)   return `vor ${diff}s`;
    if (diff < 3600) return `vor ${Math.floor(diff / 60)}min`;
    return `vor ${Math.floor(diff / 3600)}h`;
  }

  function isOnline(ts) {
    if (!ts) return false;
    return (Date.now() - new Date(ts).getTime()) < 5 * 60 * 1000;
  }

  function makeLabels(rows) {
    return rows.map(r => {
      const d = new Date(r.ts);
      return `${String(d.getDate()).padStart(2,'0')}. ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    });
  }
  function makeTooltipLabels(rows) {
    return rows.map(r => {
      const d = new Date(r.ts);
      return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    });
  }

  function buildChart(invName) {
    const canvas  = canvases[invName];
    const history = byInverter[invName]?.history ?? [];
    if (!canvas || !browser || !ChartClass || !history.length) return;
    if (charts[invName]) { charts[invName].destroy(); delete charts[invName]; }

    const labels        = makeLabels(history);
    const tooltipLabels = makeTooltipLabels(history);
    const ptR           = history.length > 120 ? 0 : 2;

    charts[invName] = new ChartClass(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Gesamt (W)',
            data: history.map(r => r.total_act_power),
            borderColor: '#e74c3c',
            backgroundColor: 'rgba(231,76,60,0.1)',
            fill: true, tension: 0.3, pointRadius: ptR, borderWidth: 2,
          },
          {
            label: 'L1 (W)',
            data: history.map(r => r.a_act_power),
            borderColor: '#3498db', backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 1.5, borderDash: [4,2],
          },
          {
            label: 'L2 (W)',
            data: history.map(r => r.b_act_power),
            borderColor: '#2ecc71', backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 1.5, borderDash: [4,2],
          },
          {
            label: 'L3 (W)',
            data: history.map(r => r.c_act_power),
            borderColor: '#f39c12', backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 1.5, borderDash: [4,2],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              title: items => tooltipLabels[items[0]?.dataIndex] ?? '',
              label: ctx => ctx.raw != null ? `${ctx.dataset.label}: ${ctx.raw.toFixed(0)} W` : '',
            },
          },
        },
        scales: {
          x: { ticks: { maxTicksLimit: 12, font: { size: 10 } } },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Leistung (W)', font: { size: 11 } },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
        },
      },
    });
  }

  function updateChart(invName) {
    const c       = charts[invName];
    const history = byInverter[invName]?.history ?? [];
    if (!c || !history.length) { buildChart(invName); return; }

    const labels        = makeLabels(history);
    const tooltipLabels = makeTooltipLabels(history);
    c.data.labels = labels;
    c.data.datasets[0].data = history.map(r => r.total_act_power);
    c.data.datasets[1].data = history.map(r => r.a_act_power);
    c.data.datasets[2].data = history.map(r => r.b_act_power);
    c.data.datasets[3].data = history.map(r => r.c_act_power);
    c.options.plugins.tooltip.callbacks.title = items => tooltipLabels[items[0]?.dataIndex] ?? '';
    c.update('none');
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      const resp = await fetch('/api/verbrauch-status');
      if (resp.ok) {
        const j = await resp.json();
        if (j.success) {
          shellInverters = j.shellInverters;
          byInverter     = j.byInverter;
          lastUpdated    = new Date();
          for (const inv of shellInverters) updateChart(inv.name);
        }
      }
    } catch {}
    loading = false;
  }

  onMount(async () => {
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);
    ChartClass = Chart;
    for (const inv of shellInverters) buildChart(inv.name);
    lastUpdated = new Date();
    interval = setInterval(refresh, 30_000);

    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  onDestroy(() => {
    clearInterval(interval);
    for (const c of Object.values(charts)) c?.destroy();
  });
</script>

<svelte:head><title>Stromverbrauch – BKW</title></svelte:head>

<!-- Header -->
<div class="d-flex flex-wrap align-items-center justify-content-between mb-3 gap-2">
  <div>
    <h4 class="mb-0 fw-bold"><i class="bi bi-plug-fill text-danger me-2"></i>Stromverbrauch</h4>
    <small class="text-muted">Shelly Pro 3EM – Live Messung</small>
  </div>
  <div class="d-flex align-items-center gap-2">
    {#if lastUpdated}
      <span class="badge bg-secondary">{timeAgo(lastUpdated.toISOString())}</span>
    {/if}
    <button class="btn btn-warning btn-sm" on:click={refresh} disabled={loading}>
      <i class="bi bi-arrow-clockwise {loading ? 'spin' : ''}"></i>
    </button>
  </div>
</div>

{#if shellInverters.length === 0}
<div class="alert alert-warning">
  <i class="bi bi-exclamation-triangle me-2"></i>
  Kein Shelly konfiguriert. Bitte die URL unter
  <a href="/admin/inverters">Admin → Inverter Settings</a> pro Inverter eintragen.
</div>
{:else}

{#each shellInverters as inv}
{@const d = byInverter[inv.name]}
{@const latest = d?.latest ?? null}
{@const consumptionToday = d?.consumptionToday ?? null}
{@const online = isOnline(latest?.ts)}

<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold d-flex justify-content-between align-items-center">
    <span>
      <i class="bi bi-plug-fill me-2" style="color:{inv.color}"></i>{inv.name}
    </span>
    <span class="badge {online ? 'bg-success' : latest ? 'bg-warning text-dark' : 'bg-secondary'}">
      {online ? 'Online' : latest ? 'Offline' : 'Keine Daten'}
    </span>
  </div>

  {#if !latest}
  <div class="card-body">
    <div class="text-muted small"><i class="bi bi-info-circle me-1"></i>Noch keine Messwerte. Warte auf ersten Sync...</div>
  </div>
  {:else}
  <div class="card-body">

    <!-- Gesamtverbrauch -->
    <div class="text-center mb-4">
      <div class="display-4 fw-bold text-danger">{fmt(latest.total_act_power, 0)} <small class="fs-4 text-muted">W</small></div>
      <div class="text-muted small">Gesamtverbrauch · {timeAgo(latest.ts)}</div>
      {#if consumptionToday != null}
        <div class="mt-1">
          <span class="badge bg-secondary fs-6">
            {consumptionToday >= 1000
              ? (consumptionToday/1000).toFixed(2) + ' kWh'
              : Math.round(consumptionToday) + ' Wh'} heute
          </span>
        </div>
      {/if}
    </div>

    <!-- Phasen -->
    <div class="row g-3 text-center mb-3">
      <div class="col-4">
        <div class="p-3 rounded" style="background:rgba(52,152,219,0.1);border:1px solid rgba(52,152,219,0.3)">
          <div class="fw-bold fs-5 text-primary">{fmt(latest.a_act_power, 0)} W</div>
          <div class="text-muted small">L1</div>
          {#if latest.a_voltage != null}
            <div style="font-size:.7rem;color:#aaa">{fmt(latest.a_voltage, 1)} V</div>
          {/if}
        </div>
      </div>
      <div class="col-4">
        <div class="p-3 rounded" style="background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.3)">
          <div class="fw-bold fs-5 text-success">{fmt(latest.b_act_power, 0)} W</div>
          <div class="text-muted small">L2</div>
          {#if latest.b_voltage != null}
            <div style="font-size:.7rem;color:#aaa">{fmt(latest.b_voltage, 1)} V</div>
          {/if}
        </div>
      </div>
      <div class="col-4">
        <div class="p-3 rounded" style="background:rgba(243,156,18,0.1);border:1px solid rgba(243,156,18,0.3)">
          <div class="fw-bold fs-5 text-warning">{fmt(latest.c_act_power, 0)} W</div>
          <div class="text-muted small">L3</div>
          {#if latest.c_voltage != null}
            <div style="font-size:.7rem;color:#aaa">{fmt(latest.c_voltage, 1)} V</div>
          {/if}
        </div>
      </div>
    </div>

    <!-- 24h Chart -->
    {#if d?.history?.length > 0}
    <div style="min-height:240px">
      <canvas bind:this={canvases[inv.name]} style="max-height:240px"></canvas>
    </div>
    {/if}

  </div>
  {/if}
</div>
{/each}

{/if}

<style>
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { display: inline-block; animation: spin 1s linear infinite; }
</style>
