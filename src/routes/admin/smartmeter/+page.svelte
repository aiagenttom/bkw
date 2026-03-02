<script>
  export let data, form;
</script>
<svelte:head><title>Smart Meter – BKW</title></svelte:head>
<div class="d-flex justify-content-between align-items-center mb-4">
  <h4 class="fw-bold mb-0"><i class="bi bi-file-earmark-spreadsheet me-2"></i>Smart Meter Import</h4>
  <a href="/admin" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-left me-1"></i>Back</a>
</div>

{#if form?.success}<div class="alert alert-success py-2">{form.success}</div>{/if}
{#if form?.error}<div class="alert alert-danger py-2">{form.error}</div>{/if}

<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold">CSV Import <small class="text-muted">(Format: datum;zeit_von;zeit_bis;verbrauch_kwh)</small></div>
  <div class="card-body">
    <form method="POST" action="?/import" enctype="multipart/form-data" class="d-flex gap-2">
      <input name="csvfile" type="file" accept=".csv,.txt" class="form-control form-control-sm" required />
      <button class="btn btn-primary btn-sm text-nowrap">
        <i class="bi bi-upload me-1"></i>Import
      </button>
    </form>
    <small class="text-muted mt-1 d-block">{data.count} records in database</small>
  </div>
</div>

<div class="card shadow-sm">
  <div class="card-body p-0">
    <div class="table-responsive">
      <table class="table table-sm table-hover mb-0 small">
        <thead class="table-dark"><tr><th>Datum</th><th>Zeit von</th><th>Zeit bis</th><th>Verbrauch (kWh)</th></tr></thead>
        <tbody>
          {#each data.rows as r}
          <tr>
            <td>{r.datum}</td><td>{r.zeit_von}</td><td>{r.zeit_bis||'–'}</td>
            <td>{r.verbrauch_kwh != null ? r.verbrauch_kwh.toFixed(3) : '–'}</td>
          </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
