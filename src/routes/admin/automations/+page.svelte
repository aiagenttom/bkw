<script>
  export let data;
  function toLocal(utc) {
    if (!utc) return '–';
    const d = new Date(utc.replace(' ', 'T') + (utc.includes('Z') ? '' : 'Z'));
    return d.toLocaleTimeString('de-AT', { timeZone: data.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
</script>
<svelte:head><title>Automations – BKW</title></svelte:head>
<div class="d-flex justify-content-between align-items-center mb-4">
  <h4 class="fw-bold mb-0"><i class="bi bi-arrow-repeat me-2"></i>Automations Log</h4>
  <a href="/admin" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-left me-1"></i>Back</a>
</div>
<div class="card shadow-sm">
  <div class="card-body p-0">
    <table class="table table-sm table-hover mb-0 small">
      <thead class="table-dark"><tr><th>Name</th><th>Started</th><th>Ended</th><th>Status</th><th>OK</th><th>Err</th><th>Msgs</th></tr></thead>
      <tbody>
        {#each data.logs as l}
        <tr>
          <td class="fw-semibold">{l.automation_name}</td>
          <td class="text-muted">{toLocal(l.started_at)}</td>
          <td class="text-muted">{toLocal(l.ended_at)}</td>
          <td><span class="badge {l.status==='SUCCESS'?'bg-success':l.status==='ERROR'?'bg-danger':'bg-secondary'}">{l.status}</span></td>
          <td class="text-success">{l.successful_rows}</td>
          <td class="text-danger">{l.error_rows}</td>
          <td>
            {#if l.msg_count > 0}
              <a href="/admin/automations/{l.id}" class="btn btn-outline-secondary btn-sm py-0">
                {l.msg_count} <i class="bi bi-chevron-right"></i>
              </a>
            {:else}–{/if}
          </td>
        </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
