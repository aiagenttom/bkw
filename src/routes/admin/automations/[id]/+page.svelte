<script>export let data; const { entry, messages } = data;</script>
<svelte:head><title>Log Messages – BKW</title></svelte:head>
<div class="d-flex justify-content-between align-items-center mb-4">
  <h4 class="fw-bold mb-0"><i class="bi bi-list-ul me-2"></i>Log Messages</h4>
  <a href="/admin/automations" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-left me-1"></i>Back</a>
</div>
<div class="alert alert-secondary py-2 small mb-3">
  <strong>{entry.automation_name}</strong> — {entry.started_at} →
  <span class="badge {entry.status==='SUCCESS'?'bg-success':entry.status==='ERROR'?'bg-danger':'bg-secondary'}">{entry.status}</span>
</div>
<div class="card shadow-sm">
  <div class="card-body p-0">
    <table class="table table-sm mb-0 small">
      <thead class="table-dark"><tr><th>Time</th><th>Type</th><th>Message</th><th>Key</th></tr></thead>
      <tbody>
        {#each messages as m}
        <tr>
          <td class="text-muted">{m.msg_timestamp?.substring(11,19)||'–'}</td>
          <td><span class="badge {m.message_type==='ERROR'?'bg-danger':m.message_type==='WARNING'?'bg-warning text-dark':'bg-info text-dark'}">{m.message_type}</span></td>
          <td>{m.message}</td><td class="text-muted">{m.pk_value||'–'}</td>
        </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
