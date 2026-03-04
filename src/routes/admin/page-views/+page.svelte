<script>
  export let data; const { views, tf } = data;
  function toLocal(utc) {
    if (!utc) return '–';
    const d = new Date(utc.replace(' ', 'T') + (utc.includes('Z') ? '' : 'Z'));
    return d.toLocaleTimeString('de-AT', { timeZone: data.timezone, hour: '2-digit', minute: '2-digit' });
  }
</script>
<svelte:head><title>Page Views – BKW</title></svelte:head>
<div class="d-flex justify-content-between align-items-center mb-4">
  <h4 class="fw-bold mb-0"><i class="bi bi-eye me-2"></i>Page Views</h4>
  <div class="d-flex gap-2">
    {#each [[1,'1d'],[7,'7d'],[30,'30d']] as [d,l]}<a href="?timeframe={d}" class="btn btn-sm {tf===d?'btn-warning':'btn-outline-secondary'}">{l}</a>{/each}
    <a href="/admin" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-left me-1"></i>Back</a>
  </div>
</div>
<div class="card shadow-sm">
  <div class="card-body p-0">
    <div class="table-responsive">
      <table class="table table-sm table-hover mb-0 small">
        <thead class="table-dark"><tr><th>Time</th><th>User</th><th>Method</th><th>Path</th><th>Status</th><th>ms</th></tr></thead>
        <tbody>
          {#each views as v}
          <tr>
            <td class="text-muted">{toLocal(v.created_at)}</td>
            <td>{v.username||'–'}</td><td>{v.method}</td><td>{v.page_path}</td>
            <td><span class="badge {v.status_code>=400?'bg-danger':'bg-success'}">{v.status_code}</span></td>
            <td>{v.elapsed_ms}</td>
          </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
