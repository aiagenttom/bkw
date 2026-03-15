<script>
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';

  export let data;

  let latest             = data.latest;
  let history            = data.history;
  let consumptionToday   = data.consumptionToday;
  let shellyEnabled      = data.shellyEnabled;
  let serviceOnline      = latest
    ? (Date.now() - new Date(latest.ts).getTime()) < 5 * 60 * 1000
    : false;

  let chart       = null;
  let canvas;
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

  let ChartClass = null;

  function buildChart() {
    if (!canvas || !browser || !ChartClass || !history.length) return;
    if (chart) { chart.destroy(); chart = null; }

    const labels        = makeLabels(history);
    const tooltipLabels = makeTooltipLabels(history);
    const ptR           = history.length > 120 ? 0 : 2;

    chart = new ChartClass(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Gesamt (W)',
            data: history.map(r => r.total_act_power),
            borderColor: '#e74c3c',
            backgroundColor: 'rgba(231,76,60,0.1)',
            fill: true, tension: 0.3, pointRadius: ptR,
            borderWidth: 2,
          },
          {
            label: 'L1 (W)',
            data: history.map(r => r.a_act_power),
            borderColor: '#3498db',
            backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 1.5,
            borderDash: [4, 2],
          },
          {
            label: 'L2 (W)',
            data: history.map(r => r.b_act_power),
            borderColor: '#2ecc71',
            backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 1.5,
            borderDash: [4, 2],
          },
          {
            label: 'L3 (W)',
            data: history.map(r => r.c_act_power),
            borderColor: '#f39c12',
            backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, borderWidth: 1.5,
            borderDash: [4, 2],
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

  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      const resp = await fetch('/api/verbrauch-status');
      if (resp.ok) {
        const j = await resp.json();
        if (j.success) {
          latest           = j.latest;
          history          = j.history;
          consumptionToday = j.consumptionToday;
          serviceOnline    = j.serviceOnline;
          lastUpdated      = new Date();

          if (chart) {
            const labels        = makeLabels(history);
            const tooltipLabels = makeTooltipLabels(history);
            chart.data.labels = labels;
            chart.data.datasets[0].data = history.map(r => r.total_act_power);
            chart.data.datasets[1].data = history.map(r => r.a_act_power);
            chart.data.datasets[2].data = history.map(r => r.b_act_power);
            chart.data.datasets[3].data = history.map(r => r.c_act_power);
            chart.options.plugins.tooltip.callbacks.title = items => tooltipLabels[items[0]?.dataIndex] ?? '';
            chart.update('none');
          }
        }
      }
    } catch {}
    loading = false;
  }

  onMount(async () => {
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);
    ChartClass = Chart;
    buildChart();
    lastUpdated = new Date();
    interval = setInterval(refresh, 30_000);

    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  onDestroy(() => {
    clearInterval(interval);
    chart?.destroy();
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
    {#if serviceOnline}
      <span class="badge bg-success">Online</span>
    {:else if latest}
      <span class="badge bg-warning text-dark">Offline</span>
    {:else}
      <span class="badge bg-secondary">Keine Daten</span>
    {/if}
    <button class="btn btn-warning btn-sm" on:click={refresh} disabled={loading}>
      <i class="bi bi-arrow-clockwise {loading ? 'spin' : ''}"></i>
    </button>
  </div>
</div>

{#if !shellyEnabled}
<div class="alert alert-warning">
  <i class="bi bi-exclamation-triangle me-2"></i>
  Kein Shelly konfiguriert. Bitte die URL unter
  <a href="/admin/inverters">Admin → Inverter Settings</a> eintragen.
</div>
{:else if !latest}
<div class="alert alert-info">
  <i class="bi bi-info-circle me-2"></i>
  Noch keine Messwerte vorhanden. Warte auf den ersten Sync...
</div>
{:else}

<!-- Live-Karte -->
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold d-flex justify-content-between align-items-center">
    <span><i class="bi bi-activity me-2 text-danger"></i>Live – aktueller Verbrauch</span>
    <small class="text-muted fw-normal">{timeAgo(latest?.ts)}</small>
  </div>
  <div class="card-body">

    <!-- Gesamtverbrauch groß -->
    <div class="text-center mb-4">
      <div class="display-4 fw-bold text-danger">{fmt(latest.total_act_power, 0)} <small class="fs-4 text-muted">W</small></div>
      <div class="text-muted small">Gesamtverbrauch</div>
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
    <div class="row g-3 text-center">
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

  </div>
</div>

<!-- 24h Chart -->
{#if history.length > 0}
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold">
    <i class="bi bi-graph-up me-2 text-danger"></i>Verbrauch letzte 24 Stunden
  </div>
  <div class="card-body" style="min-height:280px">
    <canvas bind:this={canvas} style="max-height:280px"></canvas>
  </div>
</div>
{/if}

{/if}

<style>
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { display: inline-block; animation: spin 1s linear infinite; }
</style>
