<script>
  export let data, form;
  const { byDate, monthly, inverters, months, priceMode } = data;

  const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a));

  function fmtWh(v) {
    if (v == null) return '–';
    return v >= 1000 ? (v / 1000).toFixed(2) + ' kWh' : Math.round(v) + ' Wh';
  }
  function fmtW(v)    { return v != null ? v.toFixed(0) + ' W' : '–'; }
  function fmtT(v)    { return v != null ? v.toFixed(1) + '°' : '–'; }
  function fmtEur(v)  { return v != null ? '€\u202f' + v.toFixed(2) : '–'; }
  function fmtCt(v)   { return v != null ? v.toFixed(1) + '\u202fct' : '–'; }

  // Group monthly by month key
  const monthMap = {};
  for (const r of monthly) (monthMap[r.month] ??= {})[r.inverter] = r;
  const monthKeys = [...new Set(monthly.map(r => r.month))].sort((a,b) => b.localeCompare(a));
</script>

<svelte:head><title>Daily History – BKW</title></svelte:head>

<div class="d-flex justify-content-between align-items-center mb-4">
  <h4 class="fw-bold mb-0"><i class="bi bi-calendar3 me-2"></i>Daily History</h4>
  <div class="d-flex gap-2 align-items-center">
    {#each [[1,'1M'],[3,'3M'],[6,'6M'],[12,'1Y']] as [m,l]}
    <a href="?months={m}" class="btn btn-sm {months===m?'btn-warning':'btn-outline-secondary'}">{l}</a>
    {/each}
    <a href="/admin" class="btn btn-outline-secondary btn-sm ms-2"><i class="bi bi-arrow-left me-1"></i>Back</a>
  </div>
</div>

{#if form?.success}<div class="alert alert-success py-2">{form.success}</div>{/if}
{#if form?.error}<div class="alert alert-danger py-2">{form.error}</div>{/if}

<!-- Manual snapshot trigger -->
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold"><i class="bi bi-camera me-2"></i>Manual Snapshot</div>
  <div class="card-body">
    <form method="POST" action="?/snapshot" class="d-flex gap-2 align-items-end">
      <div>
        <label class="form-label form-label-sm text-muted" for="snapshot-date">Date (empty = today)</label>
        <input id="snapshot-date" name="date" type="date" class="form-control form-control-sm" style="width:160px" />
      </div>
      <button class="btn btn-primary btn-sm">
        <i class="bi bi-camera me-1"></i>Snapshot now
      </button>
    </form>
    <small class="text-muted mt-1 d-block">
      Automatic snapshot runs daily at 23:55. Use this to trigger manually or backfill a date.
    </small>
  </div>
</div>

<!-- Monthly totals -->
{#if monthKeys.length}
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold d-flex justify-content-between align-items-center">
    <span><i class="bi bi-bar-chart me-2"></i>Monthly Totals</span>
    <small class="text-muted">
      {priceMode === 'spotty' ? '⚡ Spotty Energie' : '🔒 Fixer Tarif'}
    </small>
  </div>
  <div class="card-body p-0">
    <div class="table-responsive">
      <table class="table table-sm table-hover mb-0">
        <thead class="table-dark">
          <tr>
            <th>Month</th>
            {#each inverters as inv}<th>{inv}</th>{/each}
            <th>Yield Total</th>
            <th class="text-success">Savings</th>
          </tr>
        </thead>
        <tbody>
          {#each monthKeys as month}
          {@const row = monthMap[month] ?? {}}
          {@const totalWh = inverters.reduce((s,inv) => s + (row[inv]?.total_wh ?? 0), 0)}
          {@const totalSav = inverters.reduce((s,inv) => s + (row[inv]?.total_savings ?? 0), 0)}
          <tr>
            <td class="fw-semibold">{month}</td>
            {#each inverters as inv}
            <td>{fmtWh(row[inv]?.total_wh)}</td>
            {/each}
            <td class="fw-bold text-warning">{fmtWh(totalWh)}</td>
            <td class="fw-bold text-success">{totalSav > 0 ? fmtEur(totalSav) : '–'}</td>
          </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
{/if}

<!-- Daily detail -->
<div class="card shadow-sm">
  <div class="card-header fw-semibold d-flex justify-content-between">
    <span><i class="bi bi-table me-2"></i>Daily Details</span>
    <small class="text-muted">{dates.length} days</small>
  </div>
  <div class="card-body p-0">
    <div class="table-responsive">
      <table class="table table-sm table-hover mb-0 small">
        <thead class="table-dark">
          <tr>
            <th>Date</th>
            {#each inverters as inv}
              <th colspan="3" class="text-center">{inv}</th>
            {/each}
            <th>Total</th>
            <th class="text-success">Savings</th>
          </tr>
          <tr class="table-secondary" style="font-size:.72rem">
            <th></th>
            {#each inverters as _}
              <th>Yield</th><th>Peak</th><th>Avg</th>
            {/each}
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#if dates.length === 0}
            <tr>
              <td colspan={1 + inverters.length * 3 + 2} class="text-center text-muted py-4">
                No daily snapshots yet — first one runs tonight at 23:55
              </td>
            </tr>
          {:else}
            {#each dates as date}
            {@const row = byDate[date]}
            {@const totalWh = inverters.reduce((s,inv) => s + (row[inv]?.yield_wh ?? 0), 0)}
            {@const totalSav = inverters.reduce((s,inv) => s + (row[inv]?.savings_eur ?? 0), 0)}
            {@const hasSav = inverters.some(inv => row[inv]?.savings_eur != null)}
            <tr>
              <td class="fw-semibold text-nowrap">{date}</td>
              {#each inverters as inv}
                {@const d = row[inv]}
                <td class="text-success">{fmtWh(d?.yield_wh)}</td>
                <td class="text-warning">{fmtW(d?.peak_w)}</td>
                <td class="text-info">{fmtW(d?.avg_w)}</td>
              {/each}
              <td class="fw-bold">{fmtWh(totalWh)}</td>
              <td class="fw-bold text-success">{hasSav ? fmtEur(totalSav) : '–'}</td>
            </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
