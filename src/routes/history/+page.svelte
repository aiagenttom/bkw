<script>
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  export let data;

  const { inverters, dateSet, byDate, byInverter, monthly, months } = data;

  // Colors per inverter
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const INV_COLORS = Object.fromEntries(
    inverters.map(i => [i.name, { solid: i.color || '#888', fill: hexToRgba(i.color || '#888888', 0.85) }])
  );

  // Month range selector
  let selMonths = months;
  function changeMonths() {
    goto(`/history?months=${selMonths}`);
  }

  // Inverter filter (client-side)
  let selInv = 'all';
  $: filteredInverters = selInv === 'all' ? inverters : inverters.filter(i => i.name === selInv);

  // Whether to show savings chart
  const hasSavings = Object.values(byDate).some(d => d.savings_eur > 0);

  // Monthly summary
  const monthKeys = [...new Set(monthly.map(r => r.month))].sort();
  const monthByInv = {};
  for (const r of monthly) (monthByInv[r.month] ??= {})[r.inverter] = r;

  function fmtKwh(wh) {
    if (wh == null) return '–';
    return wh >= 1000 ? (wh/1000).toFixed(2) + ' kWh' : Math.round(wh) + ' Wh';
  }
  function fmtEur(v) { return v != null && v > 0 ? '€\u202f' + v.toFixed(2) : '–'; }

  let charts = {};
  let ChartClass;

  function updateCharts() {
    if (!ChartClass) return;
    const labels = dateSet;
    const invs = filteredInverters;

    // ── Yield datasets ───────────────────────────────────────────────────────
    const yieldDatasets = invs.map(inv => ({
      label: inv.name,
      data:  labels.map(d => {
        const wh = byInverter[inv.name]?.[d]?.yield_wh ?? 0;
        return wh ? parseFloat((wh / 1000).toFixed(3)) : null;
      }),
      backgroundColor: INV_COLORS[inv.name]?.fill || '#888',
      borderColor:     INV_COLORS[inv.name]?.solid || '#888',
      borderWidth: 1, borderRadius: 2,
    }));
    if (charts.yield) {
      charts.yield.data = { labels, datasets: yieldDatasets };
      charts.yield.update('none');
    }

    // ── Monthly yield datasets ───────────────────────────────────────────────
    const monthDatasets = invs.map(inv => ({
      label: inv.name,
      data:  monthKeys.map(m => {
        const wh = monthByInv[m]?.[inv.name]?.total_wh ?? 0;
        return wh ? parseFloat((wh / 1000).toFixed(2)) : null;
      }),
      backgroundColor: INV_COLORS[inv.name]?.fill || '#888',
      borderColor:     INV_COLORS[inv.name]?.solid || '#888',
      borderWidth: 1, borderRadius: 3,
    }));
    if (charts.monthly) {
      charts.monthly.data = { labels: monthKeys, datasets: monthDatasets };
      charts.monthly.update('none');
    }

    // ── Savings datasets ─────────────────────────────────────────────────────
    if (charts.savings) {
      const savingsDatasets = invs.map(inv => ({
        label: inv.name,
        data:  labels.map(d => {
          const s = byInverter[inv.name]?.[d]?.savings_eur ?? 0;
          return s ? parseFloat(s.toFixed(4)) : null;
        }),
        backgroundColor: INV_COLORS[inv.name]?.fill || '#888',
        borderColor:     INV_COLORS[inv.name]?.solid || '#888',
        borderWidth: 1, borderRadius: 2,
      }));
      charts.savings.data = { labels, datasets: savingsDatasets };
      charts.savings.update('none');
    }
  }

  // React to inverter filter changes
  $: if (selInv && ChartClass) updateCharts();

  onMount(async () => {
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);
    ChartClass = Chart;

    const labels = dateSet;
    const stackedBarOpts = (ylabel) => ({
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2) ?? 0} ${ylabel}`,
            footer: items => {
              const total = items.reduce((s, i) => s + (i.parsed.y || 0), 0);
              return `Gesamt: ${total.toFixed(2)} ${ylabel}`;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { maxTicksLimit: 20, maxRotation: 45, font: { size: 10 } } },
        y: { stacked: true, beginAtZero: true, title: { display: true, text: ylabel, font: { size: 11 } } },
      },
    });

    charts.yield = new Chart(document.getElementById('cYield'), {
      type: 'bar', data: { labels: [], datasets: [] }, options: stackedBarOpts('kWh'),
    });

    charts.monthly = new Chart(document.getElementById('cMonthly'), {
      type: 'bar', data: { labels: [], datasets: [] }, options: stackedBarOpts('kWh'),
    });

    if (hasSavings && document.getElementById('cSavings')) {
      charts.savings = new Chart(document.getElementById('cSavings'), {
        type: 'bar', data: { labels: [], datasets: [] }, options: stackedBarOpts('€'),
      });
    }

    updateCharts();
  });

  onDestroy(() => Object.values(charts).forEach(c => c?.destroy()));
</script>

<svelte:head><title>Verlauf – BKW</title></svelte:head>

<!-- Header -->
<div class="d-flex flex-wrap align-items-center justify-content-between mb-4 gap-2">
  <div>
    <h4 class="mb-0 fw-bold"><i class="bi bi-bar-chart-fill text-warning me-2"></i>Tagesverlauf</h4>
    <small class="text-muted">Historische Tagesdaten pro Wechselrichter</small>
  </div>
  <div class="d-flex gap-2 align-items-center flex-wrap">
    <select bind:value={selInv} class="form-select form-select-sm" style="width:150px">
      <option value="all">Alle Wechselrichter</option>
      {#each inverters as inv}<option value={inv.name}>{inv.name}</option>{/each}
    </select>
    <select id="history-months" bind:value={selMonths} on:change={changeMonths} class="form-select form-select-sm" style="width:130px">
      <option value={1}>1 Monat</option>
      <option value={3}>3 Monate</option>
      <option value={6}>6 Monate</option>
      <option value={12}>12 Monate</option>
      <option value={24}>24 Monate</option>
    </select>
  </div>
</div>

{#if dateSet.length === 0}
  <div class="alert alert-info">
    Noch keine Tagesdaten vorhanden. Der erste Snapshot wird heute um 23:55 erstellt,
    oder manuell unter <a href="/admin/daily">Admin → Daily History</a> ausgelöst.
  </div>
{:else}

<!-- Daily yield stacked bar -->
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold">
    <i class="bi bi-bar-chart-fill text-warning me-2"></i>Tagesertrag pro Wechselrichter (kWh)
  </div>
  <div class="card-body" style="min-height:300px">
    <canvas id="cYield" style="max-height:300px"></canvas>
  </div>
</div>

<!-- Monthly yield stacked bar -->
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold">
    <i class="bi bi-calendar3 me-2"></i>Monatsertrag pro Wechselrichter (kWh)
  </div>
  <div class="card-body" style="min-height:260px">
    <canvas id="cMonthly" style="max-height:260px"></canvas>
  </div>
</div>

<!-- Savings chart (only if savings data exists) -->
{#if hasSavings}
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold">
    <i class="bi bi-currency-euro text-success me-2"></i>Tägliche Ersparnis (€)
  </div>
  <div class="card-body" style="min-height:260px">
    <canvas id="cSavings" style="max-height:260px"></canvas>
  </div>
</div>
{/if}

<!-- Monthly summary table -->
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold">
    <i class="bi bi-table me-2"></i>Monatszusammenfassung
  </div>
  <div class="card-body p-0">
    <div class="table-responsive">
      <table class="table table-sm table-hover mb-0">
        <thead class="table-dark">
          <tr>
            <th>Monat</th>
            {#each filteredInverters as inv}
              <th>{inv.name}</th>
            {/each}
            {#if filteredInverters.length > 1}<th class="text-warning">Gesamt</th>{/if}
            {#if hasSavings}<th class="text-success">Ersparnis</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each monthKeys.slice().reverse() as month}
          {@const row = monthByInv[month] ?? {}}
          {@const totalWh  = filteredInverters.reduce((s,i) => s + (row[i.name]?.total_wh  ?? 0), 0)}
          {@const totalSav = filteredInverters.reduce((s,i) => s + (row[i.name]?.total_savings ?? 0), 0)}
          <tr>
            <td class="fw-semibold">{month}</td>
            {#each filteredInverters as inv}
              <td>{fmtKwh(row[inv.name]?.total_wh)}</td>
            {/each}
            {#if filteredInverters.length > 1}<td class="fw-bold text-warning">{fmtKwh(totalWh)}</td>{/if}
            {#if hasSavings}<td class="fw-bold text-success">{fmtEur(totalSav)}</td>{/if}
          </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

{/if}
