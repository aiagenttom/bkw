<script>export let data; const { users, tf } = data;</script>
<svelte:head><title>Top Users – BKW</title></svelte:head>
<div class="d-flex justify-content-between align-items-center mb-4">
  <h4 class="fw-bold mb-0"><i class="bi bi-people me-2"></i>Top Users</h4>
  <div class="d-flex gap-2">
    {#each [[1,'1d'],[7,'7d'],[30,'30d']] as [d,l]}<a href="?timeframe={d}" class="btn btn-sm {tf===d?'btn-warning':'btn-outline-secondary'}">{l}</a>{/each}
    <a href="/admin" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-left me-1"></i>Back</a>
  </div>
</div>
<div class="card shadow-sm">
  <div class="card-body p-0">
    <table class="table table-sm table-hover mb-0">
      <thead class="table-dark"><tr><th>User</th><th>Requests</th><th>Avg ms</th><th>Errors</th><th>Last Active</th></tr></thead>
      <tbody>
        {#each users as u}
        <tr>
          <td class="fw-semibold">{u.username || '(anonymous)'}</td>
          <td>{u.page_events}</td><td>{u.avg_elapsed}</td><td>{u.errors}</td>
          <td class="text-muted small">{u.most_recent?.substring(0,16)||'–'}</td>
        </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
