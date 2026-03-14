<script>
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';

  export let data;

  let latest        = data.latest;
  let history       = data.history;
  let ankerEnabled  = data.ankerEnabled;
  let ankerLifetime = data.ankerLifetime ?? null;
  let serviceOnline = false; // wird beim ersten Refresh gesetzt

  let chart = null;
  let canvas;
  let interval;
  let lastUpdated = null;
  let loading = false;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function stateLabel(s) {
    if (!s) return '–';
    const map = { charging: 'Lädt', discharging: 'Entlädt', standby: 'Standby', idle: 'Standby' };
    return map[s.toLowerCase()] ?? s;
  }
  function stateColor(s) {
    if (!s) return 'secondary';
    const m = { charging: 'success', discharging: 'warning', standby: 'secondary', idle: 'secondary' };
    return m[s.toLowerCase()] ?? 'secondary';
  }
  function socColor(soc) {
    if (soc == null) return 'secondary';
    if (soc >= 70) return 'success';
    if (soc >= 30) return 'warning';
    return 'danger';
  }
  function fmt(v, decimals = 0) {
    if (v == null) return '–';
    return Number(v).toFixed(decimals);
  }
  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60) return `vor ${diff}s`;
    if (diff < 3600) return `vor ${Math.floor(diff / 60)}min`;
    return `vor ${Math.floor(diff / 3600)}h`;
  }

  // ── Chart ──────────────────────────────────────────────────────────────────
  let ChartClass = null;

  /**
   * Baut Zeitstempel-Labels für die X-Achse: immer "DD. HH:MM".
   * Tooltip zeigt volles "DD.MM.YYYY HH:MM".
   */
  function makeLabels(rows) {
    return rows.map(r => {
      const d = new Date(r.ts);
      const day  = String(d.getDate()).padStart(2, '0');
      const hour = String(d.getHours()).padStart(2, '0');
      const min  = String(d.getMinutes()).padStart(2, '0');
      return `${day}. ${hour}:${min}`;
    });
  }

  function makeTooltipLabels(rows) {
    return rows.map(r => {
      const d   = new Date(r.ts);
      const day = String(d.getDate()).padStart(2, '0');
      const mon = String(d.getMonth() + 1).padStart(2, '0');
      const yr  = d.getFullYear();
      const hr  = String(d.getHours()).padStart(2, '0');
      const mn  = String(d.getMinutes()).padStart(2, '0');
      return `${day}.${mon}.${yr} ${hr}:${mn}`;
    });
  }

  function buildChart() {
    if (!canvas || !browser || !ChartClass) return;
    if (chart) { chart.destroy(); chart = null; }

    const labels        = makeLabels(history);
    const tooltipLabels = makeTooltipLabels(history);

    chart = new ChartClass(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'SOC (%)',
            data: history.map(r => r.soc),
            borderColor: '#2ecc71',
            backgroundColor: 'rgba(46,204,113,0.12)',
            fill: true,
            tension: 0.3,
            pointRadius: history.length > 60 ? 0 : 2,
            yAxisID: 'ySoc',
          },
          {
            label: 'Ladeleistung (W)',
            data: history.map(r => r.charge_w),
            borderColor: '#3498db',
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 0,
            yAxisID: 'yPow',
          },
          {
            label: 'Entladeleistung (W)',
            data: history.map(r => r.discharge_w),
            borderColor: '#e67e22',
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 0,
            yAxisID: 'yPow',
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              title: items => tooltipLabels[items[0]?.dataIndex] ?? '',
              label: ctx => {
                const v = ctx.raw;
                if (v == null) return '';
                if (ctx.datasetIndex === 0) return `SOC: ${v.toFixed(1)} %`;
                return `${ctx.dataset.label.split(' ')[0]}: ${v.toFixed(0)} W`;
              },
            },
          },
        },
        scales: {
          x: { ticks: { maxTicksLimit: 12 } },
          ySoc: {
            type: 'linear',
            position: 'left',
            min: 0, max: 100,
            title: { display: true, text: 'SOC (%)' },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
          yPow: {
            type: 'linear',
            position: 'right',
            min: 0,
            title: { display: true, text: 'Leistung (W)' },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
  }

  // ── Auto-refresh ───────────────────────────────────────────────────────────
  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      const resp = await fetch('/api/anker-status');
      if (resp.ok) {
        const j = await resp.json();
        if (j.success) {
          latest        = j.latest;
          history       = j.history;
          serviceOnline = j.serviceOnline;
          if (j.serviceOnline) ankerEnabled = true;
          if (j.ankerLifetime) ankerLifetime = j.ankerLifetime;
          lastUpdated   = new Date();

          // Update chart
          if (chart) {
            const labels        = makeLabels(history);
            const tooltipLabels = makeTooltipLabels(history);
            chart.data.labels = labels;
            chart.data.datasets[0].data = history.map(r => r.soc);
            chart.data.datasets[1].data = history.map(r => r.charge_w);
            chart.data.datasets[2].data = history.map(r => r.discharge_w);
            // Update tooltip title callback mit neuen Timestamps
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

    // Re-fetch immediately when tab becomes visible (browser throttles background timers)
    function onVisible() {
      if (document.visibilityState === 'visible') refresh();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });
  onDestroy(() => {
    clearInterval(interval);
    chart?.destroy();
  });
</script>

<svelte:head><title>Powerbank – BKW</title></svelte:head>

<div class="d-flex justify-content-between align-items-center mb-4">
  <div>
    <h4 class="fw-bold mb-0"><i class="bi bi-battery-charging me-2 text-success"></i>Powerbank Live</h4>
    <small class="text-muted">Anker SOLIX – Echtzeit-Status &amp; 24h-Verlauf</small>
  </div>
  <div class="d-flex gap-2 align-items-center">
    {#if loading}
      <span class="spinner-border spinner-border-sm text-primary" role="status"></span>
    {/if}
    {#if serviceOnline}
      <span class="badge bg-success"><i class="bi bi-circle-fill me-1" style="font-size:.6rem"></i>Online</span>
    {:else}
      <span class="badge bg-danger"><i class="bi bi-circle-fill me-1" style="font-size:.6rem"></i>Offline</span>
    {/if}
    <a href="/admin/powerbank" class="btn btn-outline-secondary btn-sm">
      <i class="bi bi-gear me-1"></i>Einstellungen
    </a>
  </div>
</div>

<!-- ── Status-Karten ─────────────────────────────────────────────────────── -->
{#if latest}
<div class="row g-3 mb-4">

  <!-- SOC -->
  <div class="col-12 col-md-4">
    <div class="card shadow-sm h-100">
      <div class="card-body text-center">
        <div class="text-muted small mb-1"><i class="bi bi-battery-half me-1"></i>Ladestand (SOC)</div>
        <div class="display-4 fw-bold text-{socColor(latest.soc)}">
          {fmt(latest.soc, 0)}<span class="fs-5 fw-normal ms-1">%</span>
        </div>
        <div class="progress mt-2" style="height:10px">
          <div class="progress-bar bg-{socColor(latest.soc)}"
               style="width:{Math.max(0, Math.min(100, latest.soc ?? 0))}%"
               role="progressbar"
               aria-valuenow={latest.soc ?? 0}
               aria-valuemin="0" aria-valuemax="100">
          </div>
        </div>
        <div class="mt-1 small text-muted">{timeAgo(latest.ts)}</div>
      </div>
    </div>
  </div>

  <!-- Ladeleistung -->
  <div class="col-6 col-md-4">
    <div class="card shadow-sm h-100">
      <div class="card-body text-center">
        <div class="text-muted small mb-1"><i class="bi bi-lightning-charge me-1 text-primary"></i>Ladeleistung</div>
        <div class="display-5 fw-bold text-primary">
          {fmt(latest.charge_w, 0)}<span class="fs-6 fw-normal ms-1">W</span>
        </div>
        <div class="small text-muted mt-1">
          {latest.charge_w > 0 ? '↑ Lädt aus PV' : 'Kein Laden'}
        </div>
      </div>
    </div>
  </div>

  <!-- Entladeleistung -->
  <div class="col-6 col-md-4">
    <div class="card shadow-sm h-100">
      <div class="card-body text-center">
        <div class="text-muted small mb-1"><i class="bi bi-house me-1 text-warning"></i>Entladeleistung</div>
        <div class="display-5 fw-bold text-warning">
          {fmt(latest.discharge_w, 0)}<span class="fs-6 fw-normal ms-1">W</span>
        </div>
        <div class="small text-muted mt-1">
          {latest.discharge_w > 0 ? '↓ Gibt an Haushalt ab' : 'Keine Abgabe'}
        </div>
      </div>
    </div>
  </div>

</div>

<!-- Status-Badge -->
<div class="mb-3">
  <span class="badge bg-{stateColor(latest.state)} fs-6 px-3 py-2">
    <i class="bi bi-circle-fill me-2" style="font-size:.6rem"></i>
    {stateLabel(latest.state)}
  </span>
  {#if latest.device_sn}
    <span class="ms-2 text-muted small">SN: {latest.device_sn}</span>
  {/if}
</div>

{:else}
<!-- Kein Messwert vorhanden -->
<div class="alert alert-warning d-flex align-items-center gap-2 mb-4">
  <i class="bi bi-exclamation-triangle fs-5"></i>
  <div>
    <strong>Keine Daten verfügbar.</strong>
    {#if !ankerEnabled}
      Anker-Anbindung nicht konfiguriert.
      Bitte unter <a href="/admin/powerbank" class="alert-link">Einstellungen</a> E-Mail und Passwort eintragen.
    {:else}
      Konfiguriert, aber noch keine Messwerte abgerufen. Seite lädt in Kürze.
    {/if}
  </div>
</div>
{/if}

<!-- ── Lifetime-Statistiken ──────────────────────────────────────────────── -->
{#if ankerLifetime}
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold">
    <i class="bi bi-trophy me-2 text-warning"></i>Lifetime-Statistiken
    {#if ankerLifetime.retain_load_w != null}
      <span class="ms-2 badge bg-secondary fw-normal">Ausgabe konfiguriert: {ankerLifetime.retain_load_w} W</span>
    {/if}
  </div>
  <div class="card-body">
    <div class="row g-3 text-center">
      {#if ankerLifetime.kwh != null}
      <div class="col-12 col-sm-4">
        <div class="fs-3 fw-bold text-success">{ankerLifetime.kwh.toLocaleString('de-AT', {maximumFractionDigits: 1})}<span class="fs-6 fw-normal ms-1">kWh</span></div>
        <div class="text-muted small"><i class="bi bi-sun me-1"></i>Erzeugte Energie</div>
      </div>
      {/if}
      {#if ankerLifetime.co2 != null}
      <div class="col-12 col-sm-4">
        <div class="fs-3 fw-bold text-info">{ankerLifetime.co2.toLocaleString('de-AT', {maximumFractionDigits: 1})}<span class="fs-6 fw-normal ms-1">kg</span></div>
        <div class="text-muted small"><i class="bi bi-cloud me-1"></i>CO₂ eingespart</div>
      </div>
      {/if}
      {#if ankerLifetime.eur != null}
      <div class="col-12 col-sm-4">
        <div class="fs-3 fw-bold text-warning">{ankerLifetime.eur.toLocaleString('de-AT', {minimumFractionDigits: 2, maximumFractionDigits: 2})}<span class="fs-6 fw-normal ms-1">€</span></div>
        <div class="text-muted small"><i class="bi bi-piggy-bank me-1"></i>Geldersparnis</div>
      </div>
      {/if}
    </div>
  </div>
</div>
{/if}

<!-- ── 24h Verlauf ────────────────────────────────────────────────────────── -->
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold d-flex justify-content-between align-items-center">
    <span><i class="bi bi-graph-up me-2"></i>24h-Verlauf – SOC &amp; Leistung</span>
    <small class="text-muted fw-normal">
      {history.length} Messwerte
      {#if lastUpdated}· aktualisiert {lastUpdated.toLocaleTimeString('de-AT', {hour:'2-digit', minute:'2-digit'})}{/if}
    </small>
  </div>
  <div class="card-body">
    {#if history.length === 0}
      <p class="text-muted text-center py-4 mb-0">Noch keine Verlaufsdaten gespeichert.</p>
    {:else}
      <canvas bind:this={canvas} style="max-height:320px"></canvas>
    {/if}
  </div>
</div>

<!-- ── Info-Box ───────────────────────────────────────────────────────────── -->
<div class="alert alert-info py-2 small">
  <i class="bi bi-info-circle me-1"></i>
  Diese Seite aktualisiert sich automatisch alle <strong>30 Sekunden</strong>.
  Daten kommen direkt von der Anker SOLIX Cloud-API (Node.js nativ) und werden in der Datenbank gespeichert.
</div>
