<script>
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';

  export let data;

  $: ({ shellInverters, selInv, byInverter, today, selDate, minDate } = data);

  // Date navigation
  function addDays(d, n) {
    const dt = new Date(d + 'T12:00:00');
    dt.setDate(dt.getDate() + n);
    return dt.toISOString().substring(0, 10);
  }
  $: prevDate  = addDays(selDate, -1);
  $: nextDate  = addDays(selDate, +1);
  $: canGoPrev = prevDate >= minDate;
  $: canGoNext = nextDate <= today;
  $: isToday   = selDate === today;

  function navHref(date, inv) {
    const d = date ?? selDate;
    const i = inv ?? selInv?.name ?? '';
    return `/verbrauch?date=${d}&inv=${encodeURIComponent(i)}`;
  }

  function formatDate(d) {
    return new Date(d + 'T12:00:00').toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  let ChartCls   = null;
  let chart      = null;
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

  function isOnline(ts) {
    return ts ? (Date.now() - new Date(ts).getTime()) < 5 * 60 * 1000 : false;
  }

  function makeLabels(rows) {
    return rows.map(r => {
      const d = new Date(r.ts);
      return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    });
  }
  function makeTooltipLabels(rows) {
    return rows.map(r => {
      const d = new Date(r.ts);
      return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    });
  }

  function buildChart() {
    const invData = selInv ? byInverter[selInv.name] : null;
    const history = invData?.history ?? [];
    const prices  = invData?.prices  ?? [];
    if (!canvas || !browser || !ChartCls || !history.length) return;
    if (chart) { chart.destroy(); chart = null; }

    const labels        = makeLabels(history);
    const tooltipLabels = makeTooltipLabels(history);
    const hasPrices     = prices.some(p => p != null);

    chart = new ChartCls(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Gesamt (W)', data: history.map(r => r.total_act_power),
            borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.08)',
            fill: true, tension: 0, pointRadius: 0, borderWidth: 2,
            yAxisID: 'y' },
          { label: 'L1 (W)', data: history.map(r => r.a_act_power),
            borderColor: '#3498db', backgroundColor: 'transparent',
            tension: 0, pointRadius: 0, borderWidth: 1.5, borderDash: [4,2],
            yAxisID: 'y' },
          { label: 'L2 (W)', data: history.map(r => r.b_act_power),
            borderColor: '#2ecc71', backgroundColor: 'transparent',
            tension: 0, pointRadius: 0, borderWidth: 1.5, borderDash: [4,2],
            yAxisID: 'y' },
          { label: 'L3 (W)', data: history.map(r => r.c_act_power),
            borderColor: '#f39c12', backgroundColor: 'transparent',
            tension: 0, pointRadius: 0, borderWidth: 1.5, borderDash: [4,2],
            yAxisID: 'y' },
          { label: 'Preis (ct/kWh)', data: prices,
            borderColor: '#9b59b6', backgroundColor: 'transparent',
            tension: 0, pointRadius: 0, borderWidth: 1.5, borderDash: [6,3],
            yAxisID: 'y2' },
        ],
      },
      options: {
        animation: false,
        devicePixelRatio: Math.min(window.devicePixelRatio, 1.5),
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              title: items => tooltipLabels[items[0]?.dataIndex] ?? '',
              label: ctx => {
                if (ctx.raw == null) return '';
                if (ctx.dataset.yAxisID === 'y2') return `${ctx.dataset.label}: ${ctx.raw.toFixed(1)} ct`;
                return `${ctx.dataset.label}: ${ctx.raw.toFixed(0)} W`;
              },
            },
          },
        },
        scales: {
          x: { ticks: { maxTicksLimit: 12, font: { size: 10 } } },
          y: { beginAtZero: true,
               title: { display: true, text: 'Leistung (W)', font: { size: 11 } },
               grid: { color: 'rgba(0,0,0,0.05)' } },
          y2: { position: 'right',
                display: hasPrices,
                beginAtZero: false,
                title: { display: true, text: 'Preis (ct/kWh)', font: { size: 11 }, color: '#9b59b6' },
                grid: { drawOnChartArea: false },
                ticks: { font: { size: 10 }, color: '#9b59b6',
                         callback: v => v != null ? v.toFixed(1) + ' ct' : '' } },
        },
      },
    });
  }

  async function refresh() {
    if (!isToday || loading) return;
    loading = true;
    try {
      const inv = selInv?.name ?? '';
      const resp = await fetch(`/api/verbrauch-status?inv=${encodeURIComponent(inv)}`);
      if (resp.ok) {
        const j = await resp.json();
        if (j.success && inv && j.byInverter[inv]) {
          byInverter = j.byInverter;
          lastUpdated = new Date();
          // Chart updaten statt neu bauen
          const history = j.byInverter[inv].history ?? [];
          const prices  = j.byInverter[inv].prices  ?? [];
          if (chart && history.length) {
            chart.data.labels = makeLabels(history);
            const tl = makeTooltipLabels(history);
            chart.data.datasets[0].data = history.map(r => r.total_act_power);
            chart.data.datasets[1].data = history.map(r => r.a_act_power);
            chart.data.datasets[2].data = history.map(r => r.b_act_power);
            chart.data.datasets[3].data = history.map(r => r.c_act_power);
            chart.data.datasets[4].data = prices;
            chart.options.scales.y2.display = prices.some(p => p != null);
            chart.options.plugins.tooltip.callbacks.title = items => tl[items[0]?.dataIndex] ?? '';
            chart.update('none');
          } else {
            buildChart();
          }
        }
      }
    } catch {}
    loading = false;
  }

  // Chart neu bauen wann immer die Daten oder das Datum wechseln (SvelteKit-Navigation)
  // ChartCls ist erst nach onMount gesetzt → erste Auswertung ist immer ein No-op
  $: if (ChartCls) {
    byInverter; // als reaktive Abhängigkeit tracken
    buildChart();
  }

  onMount(async () => {
    if (!browser) return;
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);
    ChartCls = Chart; // löst obigen $:-Block aus → buildChart()
    lastUpdated = new Date();
    if (isToday) interval = setInterval(refresh, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible' && isToday) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  onDestroy(() => { clearInterval(interval); chart?.destroy(); });

  // Stundensummierung aus 15-min-History
  $: hourlyRows = (() => {
    const invData = selInv ? byInverter[selInv.name] : null;
    const history = invData?.history ?? [];
    const prices  = invData?.prices  ?? [];
    if (!history.length) return [];
    const map = {};
    history.forEach((r, i) => {
      const h = new Date(r.ts).getHours();
      if (!map[h]) map[h] = { hour: h, wh: 0, priceSum: 0, priceWh: 0, priceCount: 0 };
      const wh = r.total_act_power > 0 ? r.total_act_power * 0.25 : 0; // 15-min bucket
      map[h].wh += wh;
      if (prices[i] != null) { map[h].priceSum += prices[i]; map[h].priceWh += wh; map[h].priceCount++; }
    });
    return Object.values(map).sort((a, b) => a.hour - b.hour).map(row => {
      const avgPrice = row.priceCount > 0 ? row.priceSum / row.priceCount : null;
      const costEur  = avgPrice != null ? row.wh / 1000 * avgPrice / 100 : null;
      return { hour: row.hour, wh: row.wh, avgPrice, costEur };
    });
  })();

  $: hourlyTotals = (() => {
    const wh   = hourlyRows.reduce((s, r) => s + r.wh, 0);
    const cost = hourlyRows.reduce((s, r) => s + (r.costEur ?? 0), 0);
    // Verbrauchsgewichteter Durchschnittspreis
    const whWithPrice = hourlyRows.filter(r => r.avgPrice != null).reduce((s, r) => s + r.wh, 0);
    const sumWP       = hourlyRows.filter(r => r.avgPrice != null).reduce((s, r) => s + r.avgPrice * r.wh, 0);
    const avgPrice    = whWithPrice > 0 ? sumWP / whWithPrice : null;
    return { wh, cost: cost > 0 ? cost : null, avgPrice };
  })();
</script>

<svelte:head><title>Stromverbrauch – BKW</title></svelte:head>

<!-- Header -->
<div class="d-flex flex-wrap align-items-center justify-content-between mb-3 gap-2">
  <div>
    <h4 class="mb-0 fw-bold"><i class="bi bi-plug-fill text-danger me-2"></i>Stromverbrauch</h4>
    <small class="text-muted">Shelly Pro 3EM – Historische Daten</small>
  </div>
  <div class="d-flex align-items-center gap-2">
    {#if isToday && lastUpdated}
      <span class="badge bg-secondary">{timeAgo(lastUpdated.toISOString())}</span>
    {/if}
    {#if isToday}
      <button class="btn btn-warning btn-sm" on:click={refresh} disabled={loading} aria-label="Refresh">
        <i class="bi bi-arrow-clockwise {loading ? 'spin' : ''}"></i>
      </button>
    {/if}
  </div>
</div>

{#if shellInverters.length === 0}
<div class="alert alert-warning">
  <i class="bi bi-exclamation-triangle me-2"></i>
  Kein Shelly konfiguriert. Bitte die URL unter
  <a href="/admin/inverters">Admin → Inverter Settings</a> pro Inverter eintragen.
</div>
{:else}

<!-- Inverter + Datumsnavigation -->
<div class="d-flex align-items-center gap-2 mb-4 flex-wrap">

  <!-- Inverter-Auswahl -->
  {#if shellInverters.length > 1}
  <select class="form-select form-select-sm" style="width:auto"
          on:change={e => { window.location.href = navHref(selDate, e.target.value); }}>
    {#each shellInverters as inv}
      <option value={inv.name} selected={inv.name === selInv?.name}>{inv.name}</option>
    {/each}
  </select>
  {:else}
  <span class="fw-semibold" style="color:{selInv?.color}">
    <i class="bi bi-plug-fill me-1"></i>{selInv?.name}
  </span>
  {/if}

  <div class="vr d-none d-sm-block"></div>

  <!-- Datum Prev -->
  {#if canGoPrev}
    <a href={navHref(prevDate)} class="btn btn-outline-secondary btn-sm" aria-label="Vorheriger Tag">
      <i class="bi bi-chevron-left"></i>
    </a>
  {:else}
    <button class="btn btn-outline-secondary btn-sm" disabled aria-label="Vorheriger Tag">
      <i class="bi bi-chevron-left"></i>
    </button>
  {/if}

  <a href={navHref(today)} class="btn btn-sm {isToday ? 'btn-primary' : 'btn-outline-primary'}">Heute</a>
  <span class="fw-semibold">{formatDate(selDate)}</span>

  <!-- Datum Next -->
  {#if canGoNext}
    <a href={navHref(nextDate)} class="btn btn-outline-secondary btn-sm ms-auto" aria-label="Nächster Tag">
      <i class="bi bi-chevron-right"></i>
    </a>
  {:else}
    <button class="btn btn-outline-secondary btn-sm ms-auto" disabled aria-label="Nächster Tag">
      <i class="bi bi-chevron-right"></i>
    </button>
  {/if}
</div>

<!-- Daten-Karte -->
{#if selInv}
{@const d = byInverter[selInv.name]}
{@const latest = d?.latest ?? null}
{@const consumptionToday = d?.consumptionToday ?? null}
{@const costToday = d?.costToday ?? null}
{@const online = isOnline(latest?.ts)}

<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold d-flex justify-content-between align-items-center">
    <span><i class="bi bi-plug-fill me-2" style="color:{selInv.color}"></i>{selInv.name}</span>
    {#if isToday}
      <span class="badge {online ? 'bg-success' : latest ? 'bg-warning text-dark' : 'bg-secondary'}">
        {online ? 'Online' : latest ? 'Offline' : 'Keine Daten'}
      </span>
    {/if}
  </div>
  <div class="card-body">

    {#if isToday && latest}
    <div class="text-center mb-4">
      <div class="display-4 fw-bold text-danger">{fmt(latest.total_act_power, 0)} <small class="fs-4 text-muted">W</small></div>
      <div class="text-muted small">Live · {timeAgo(latest.ts)}</div>
    </div>
    <div class="row g-3 text-center mb-4">
      <div class="col-4">
        <div class="p-2 rounded" style="background:rgba(52,152,219,0.1);border:1px solid rgba(52,152,219,0.3)">
          <div class="fw-bold text-primary">{fmt(latest.a_act_power, 0)} W</div>
          <div class="text-muted small">L1</div>
        </div>
      </div>
      <div class="col-4">
        <div class="p-2 rounded" style="background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.3)">
          <div class="fw-bold text-success">{fmt(latest.b_act_power, 0)} W</div>
          <div class="text-muted small">L2</div>
        </div>
      </div>
      <div class="col-4">
        <div class="p-2 rounded" style="background:rgba(243,156,18,0.1);border:1px solid rgba(243,156,18,0.3)">
          <div class="fw-bold text-warning">{fmt(latest.c_act_power, 0)} W</div>
          <div class="text-muted small">L3</div>
        </div>
      </div>
    </div>
    {/if}

    <!-- Verbrauch + Kosten Badges -->
    {#if consumptionToday != null || costToday != null}
    <div class="d-flex justify-content-center gap-2 flex-wrap mb-3">
      {#if consumptionToday != null}
      <span class="badge bg-secondary fs-6">
        <i class="bi bi-lightning-fill me-1"></i>
        {consumptionToday >= 1000
          ? (consumptionToday/1000).toFixed(2) + ' kWh'
          : Math.round(consumptionToday) + ' Wh'}
        {isToday ? ' heute' : ' gesamt'}
      </span>
      {/if}
      {#if costToday != null}
      <span class="badge fs-6" style="background:rgba(155,89,182,0.15);color:#7d3c98;border:1px solid rgba(155,89,182,0.4)">
        <i class="bi bi-currency-euro me-1"></i>{costToday.toFixed(2)} €
        {isToday ? ' bisher' : ' gesamt'}
      </span>
      {/if}
    </div>
    {/if}

    {#if d?.history?.length > 0}
    <div style="min-height:240px">
      <canvas bind:this={canvas} style="max-height:260px"></canvas>
    </div>
    {:else}
    <div class="text-muted small text-center py-3">
      <i class="bi bi-info-circle me-1"></i>Keine Daten für diesen Tag
    </div>
    {/if}

    <!-- Stundentabelle -->
    {#if hourlyRows.length > 0}
    <div class="table-responsive mt-3">
      <table class="table table-sm table-hover mb-0" style="font-size:0.82rem">
        <thead class="table-light">
          <tr>
            <th class="text-muted fw-normal">Stunde</th>
            <th class="text-end text-muted fw-normal">Verbrauch</th>
            <th class="text-end fw-normal" style="color:#9b59b6">Ø Preis</th>
            <th class="text-end text-muted fw-normal">Kosten</th>
          </tr>
        </thead>
        <tbody>
          {#each hourlyRows as row}
          <tr class="{row.wh < 1 ? 'text-muted' : ''}">
            <td>{String(row.hour).padStart(2,'0')}:00 – {String(row.hour + 1).padStart(2,'0')}:00</td>
            <td class="text-end font-monospace">
              {row.wh >= 1000 ? (row.wh/1000).toFixed(2) + ' kWh' : Math.round(row.wh) + ' Wh'}
            </td>
            <td class="text-end font-monospace" style="color:#9b59b6">
              {row.avgPrice != null ? row.avgPrice.toFixed(2) + ' ct' : '–'}
            </td>
            <td class="text-end font-monospace">
              {row.costEur != null ? (row.costEur < 0.01 ? '< 0.01' : row.costEur.toFixed(3)) + ' €' : '–'}
            </td>
          </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr class="fw-semibold border-top" style="border-top-width:2px!important">
            <td>Gesamt</td>
            <td class="text-end font-monospace">
              {hourlyTotals.wh >= 1000 ? (hourlyTotals.wh/1000).toFixed(2) + ' kWh' : Math.round(hourlyTotals.wh) + ' Wh'}
            </td>
            <td class="text-end font-monospace" style="color:#9b59b6">
              {hourlyTotals.avgPrice != null ? hourlyTotals.avgPrice.toFixed(2) + ' ct' : '–'}
            </td>
            <td class="text-end font-monospace">
              {hourlyTotals.cost != null ? hourlyTotals.cost.toFixed(2) + ' €' : '–'}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
    {/if}

  </div>
</div>
{/if}

{/if}

<style>
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { display: inline-block; animation: spin 1s linear infinite; }
</style>
