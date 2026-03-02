<script>export let data; const { pages, tf } = data;</script>
<svelte:head><title>Page Performance – BKW</title></svelte:head>
<div class="d-flex justify-content-between align-items-center mb-4">
  <h4 class="fw-bold mb-0"><i class="bi bi-speedometer me-2"></i>Page Performance</h4>
  <div class="d-flex gap-2">
    {#each [[1,'1d'],[7,'7d'],[30,'30d']] as [d,l]}<a href="?timeframe={d}" class="btn btn-sm {tf===d?'btn-warning':'btn-outline-secondary'}">{l}</a>{/each}
    <a href="/admin" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-left me-1"></i>Back</a>
  </div>
</div>
<div class="card shadow-sm">
  <div class="card-body p-0">
    <table class="table table-sm table-hover mb-0 small">
      <thead class="table-dark"><tr><th>Path</th><th>Views</th><th>Avg ms</th><th>Max ms</th><th>Users</th><th>Errors</th></tr></thead>
      <tbody>
        {#each pages as p}
        <tr>
          <td>{p.page_path}</td><td>{p.page_views}</td>
          <td class="{p.avg_elapsed>500?'text-danger fw-bold':''}">{p.avg_elapsed}</td>
          <td>{p.max_elapsed}</td><td>{p.distinct_users}</td><td>{p.errors}</td>
        </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
