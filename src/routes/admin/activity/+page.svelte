<script>
  export let data;
  const { hourly, stats, tf } = data;
</script>

<svelte:head><title>Activity – BKW</title></svelte:head>
<div class="d-flex justify-content-between align-items-center mb-4">
  <h4 class="fw-bold mb-0"><i class="bi bi-bar-chart me-2"></i>Activity Dashboard</h4>
  <div class="d-flex gap-2">
    {#each [[1,'1d'],[7,'7d'],[30,'30d']] as [days, label]}
    <a href="?timeframe={days}" class="btn btn-sm {tf===days?'btn-warning':'btn-outline-secondary'}">{label}</a>
    {/each}
    <a href="/admin" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-left me-1"></i>Back</a>
  </div>
</div>

<div class="row g-3 mb-4">
  {#each [
    ['total_requests', 'Requests',       'text-primary',  'bi-cursor'],
    ['distinct_users', 'Unique Users',   'text-success',  'bi-people'],
    ['avg_elapsed',    'Avg Response ms','text-warning',  'bi-stopwatch'],
    ['errors',         'Errors',         'text-danger',   'bi-exclamation-triangle'],
  ] as [key, label, cls, icon]}
  <div class="col-6 col-md-3">
    <div class="card shadow-sm text-center">
      <div class="card-body py-3">
        <i class="bi {icon} fs-4 {cls} mb-1 d-block"></i>
        <div class="fs-4 fw-bold {cls}">{stats?.[key] ?? 0}</div>
        <div class="text-muted small">{label}</div>
      </div>
    </div>
  </div>
  {/each}
</div>

<div class="card shadow-sm">
  <div class="card-header fw-semibold">Hourly Events</div>
  <div class="card-body p-0">
    <div class="table-responsive">
      <table class="table table-sm table-hover mb-0 small">
        <thead class="table-dark"><tr><th>Hour</th><th>Events</th></tr></thead>
        <tbody>
          {#each hourly as r}
          <tr><td class="text-muted">{r.hour}</td><td>{r.events}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
