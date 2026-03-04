<script>
  export let data; const { errors, tf } = data;
  function toLocal(utc) {
    if (!utc) return '–';
    const d = new Date(utc.replace(' ', 'T') + (utc.includes('Z') ? '' : 'Z'));
    return d.toLocaleString('de-AT', { timeZone: data.timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
</script>
<svelte:head><title>Error Log – BKW</title></svelte:head>
<div class="d-flex justify-content-between align-items-center mb-4">
  <h4 class="fw-bold mb-0"><i class="bi bi-exclamation-triangle me-2"></i>Error Log</h4>
  <div class="d-flex gap-2">
    {#each [[1,'1d'],[7,'7d'],[30,'30d']] as [d,l]}<a href="?timeframe={d}" class="btn btn-sm {tf===d?'btn-warning':'btn-outline-secondary'}">{l}</a>{/each}
    <a href="/admin" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-left me-1"></i>Back</a>
  </div>
</div>
<div class="card shadow-sm">
  <div class="card-body p-0">
    <table class="table table-sm table-hover mb-0 small">
      <thead class="table-dark"><tr><th>Time</th><th>Status</th><th>Method</th><th>Path</th><th>User</th><th>Error</th></tr></thead>
      <tbody>
        {#each errors as e}
        <tr>
          <td class="text-muted">{toLocal(e.created_at)}</td>
          <td><span class="badge {e.status_code>=500?'bg-danger':'bg-warning text-dark'}">{e.status_code}</span></td>
          <td>{e.method}</td><td>{e.page_path}</td>
          <td>{e.username||'–'}</td><td class="text-muted">{e.error_message||'–'}</td>
        </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
