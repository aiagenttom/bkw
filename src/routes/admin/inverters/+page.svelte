<script>
  export let data, form;
  const { settings } = data;
  let inverters = data.inverters;

  function resolveUrl(inv) {
    if (inv.full_url?.trim()) return inv.full_url.trim();
    const base = (settings.api_base_url || '').replace(/\/$/, '');
    const rel  = (inv.api_path || '').replace(/^\//, '');
    return rel ? `${base}/${rel}` : base;
  }

  async function testSync(id) {
    const r = await fetch(`/api/inverters/${id}/sync`, { method: 'POST' });
    const j = await r.json();
    return j.success ? `${j.data?.power_ac ?? '?'} W AC` : `Error: ${j.error}`;
  }

  let syncResults = {};
  async function doSync(id) {
    syncResults[id] = '…';
    syncResults[id] = await testSync(id);
  }
</script>

<svelte:head><title>Inverter Settings – BKW</title></svelte:head>

<div class="d-flex justify-content-between align-items-center mb-4">
  <h4 class="fw-bold mb-0"><i class="bi bi-lightning me-2"></i>Inverter Settings</h4>
  <a href="/admin" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-left me-1"></i>Back</a>
</div>

{#if form?.success}<div class="alert alert-success py-2">{form.success}</div>{/if}
{#if form?.error}<div class="alert alert-danger py-2">{form.error}</div>{/if}

<!-- Global settings -->
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold"><i class="bi bi-sliders me-2"></i>Global Settings</div>
  <div class="card-body">
    <form method="POST" action="?/saveSettings">
      <div class="row g-3">
        <div class="col-12 col-md-6">
          <label class="form-label fw-semibold small">API Base URL</label>
          <input name="api_base_url" class="form-control form-control-sm"
                 value={settings.api_base_url || ''} />
          <small class="text-muted">Used when no full_url is set on an inverter</small>
        </div>
        <div class="col-6 col-md-3">
          <label class="form-label fw-semibold small">Sync Interval (min)</label>
          <input name="sync_interval" type="number" min="1" class="form-control form-control-sm"
                 value={settings.sync_interval || '1'} />
        </div>
        <div class="col-6 col-md-3">
          <label class="form-label fw-semibold small">Auto-refresh (s)</label>
          <input name="auto_refresh_s" type="number" min="5" class="form-control form-control-sm"
                 value={settings.auto_refresh_s || '30'} />
        </div>
      </div>

      <hr class="my-3" />

      <!-- Tariff / Savings settings -->
      <div class="fw-semibold small mb-2"><i class="bi bi-currency-euro me-1"></i>Tariff &amp; Savings</div>
      <div class="row g-3">
        <div class="col-12 col-md-4">
          <label class="form-label fw-semibold small">Tariff Mode</label>
          <select name="price_mode" class="form-select form-select-sm">
            <option value="fixed"  selected={settings.price_mode !== 'spotty'}>Fixer Tarif (ct/kWh)</option>
            <option value="spotty" selected={settings.price_mode === 'spotty'}>Spotty Energie API</option>
          </select>
        </div>
        <div class="col-6 col-md-2">
          <label class="form-label fw-semibold small">Fixer Tarif (ct/kWh)</label>
          <div class="input-group input-group-sm">
            <input name="fixed_price_ct" type="number" min="0" step="0.1" class="form-control form-control-sm"
                   value={settings.fixed_price_ct || '30'} />
            <span class="input-group-text">ct</span>
          </div>
          <small class="text-muted">Used when mode is "Fixer Tarif"</small>
        </div>
        <div class="col-12 col-md-4">
          <label class="form-label fw-semibold small">Spotty API URL</label>
          <input name="spotty_url" class="form-control form-control-sm"
                 value={settings.spotty_url || ''} />
          <small class="text-muted">Used when mode is "Spotty Energie"</small>
        </div>
        <div class="col-6 col-md-2">
          <label class="form-label fw-semibold small">UTC Offset (h)</label>
          <div class="input-group input-group-sm">
            <input name="tz_offset_h" type="number" min="-12" max="14" class="form-control form-control-sm"
                   value={settings.tz_offset_h || '1'} />
            <span class="input-group-text">h</span>
          </div>
          <small class="text-muted">1=CET, 2=CEST</small>
        </div>
      </div>

      <button class="btn btn-primary btn-sm mt-3">
        <i class="bi bi-save me-1"></i>Save Settings
      </button>
    </form>
  </div>
</div>

<!-- Inverter cards -->
{#each inverters as inv}
<div class="card shadow-sm mb-3">
  <div class="card-header fw-semibold d-flex justify-content-between align-items-center">
    <span>
      <i class="bi bi-lightning-fill me-2" style="color:{inv.color}"></i>{inv.name}
    </span>
    <div class="d-flex gap-2 align-items-center">
      <span class="badge" class:bg-success={inv.enabled} class:bg-secondary={!inv.enabled}>
        {inv.enabled ? 'Enabled' : 'Disabled'}
      </span>
      <span class="badge bg-info text-dark" style="font-size:.7rem">
        {inv.full_url?.trim() ? '⚡ direct URL' : '🔀 nginx proxy'}
      </span>
    </div>
  </div>
  <div class="card-body">
    <div class="text-muted small mb-2">
      <i class="bi bi-link-45deg"></i>
      Resolved: <code>{resolveUrl(inv)}</code>
    </div>
    <form method="POST" action="?/update">
      <input type="hidden" name="id" value={inv.id} />
      <div class="row g-2 mb-2">
        <div class="col-12 col-md-4">
          <label class="form-label form-label-sm">Name</label>
          <input name="name" class="form-control form-control-sm" value={inv.name} required />
        </div>
        <div class="col-12 col-md-4">
          <label class="form-label form-label-sm">Full URL <span class="text-muted">(optional override)</span></label>
          <input name="full_url" class="form-control form-control-sm"
                 placeholder="http://192.168.1.x/api/livedata/status"
                 value={inv.full_url || ''} />
        </div>
        <div class="col-12 col-md-3">
          <label class="form-label form-label-sm">Nginx Path</label>
          <div class="input-group input-group-sm">
            <span class="input-group-text text-muted small" style="font-size:.7rem">
              {(settings.api_base_url||'').replace(/\/$/,'')}/
            </span>
            <input name="api_path" class="form-control form-control-sm"
                   placeholder="opendtu_erwin/" value={inv.api_path || ''} />
          </div>
        </div>
        <div class="col-6 col-md-1">
          <label class="form-label form-label-sm">Color</label>
          <input name="color" type="color" class="form-control form-control-sm form-control-color"
                 value={inv.color || '#3498db'} />
        </div>
      </div>
      <!-- Per-inverter tariff -->
      <div class="row g-2 mb-2 align-items-end border-top pt-2 mt-1">
        <div class="col-12">
          <small class="text-muted fw-semibold"><i class="bi bi-currency-euro me-1"></i>Tarif</small>
        </div>
        <div class="col-6 col-md-3">
          <label class="form-label form-label-sm">Modus</label>
          <select name="price_mode" class="form-select form-select-sm">
            <option value="global" selected={!inv.price_mode}>
              Global ({settings.price_mode === 'spotty' ? 'Spotty' : `${settings.fixed_price_ct ?? 30} ct`})
            </option>
            <option value="fixed"  selected={inv.price_mode === 'fixed'}>Fixer Tarif</option>
            <option value="spotty" selected={inv.price_mode === 'spotty'}>Spotty Energie</option>
          </select>
        </div>
        <div class="col-6 col-md-2">
          <label class="form-label form-label-sm">Fixer Preis (ct/kWh)</label>
          <div class="input-group input-group-sm">
            <input name="fixed_price_ct" type="number" min="0" step="0.1"
                   class="form-control form-control-sm"
                   placeholder="{settings.fixed_price_ct ?? 30} (global)"
                   value={inv.fixed_price_ct ?? ''} />
            <span class="input-group-text">ct</span>
          </div>
        </div>
      </div>

      <div class="d-flex gap-2 flex-wrap">
        <button class="btn btn-primary btn-sm">
          <i class="bi bi-save me-1"></i>Save
        </button>
      </div>
    </form>

    <div class="d-flex gap-2 mt-2 flex-wrap">
      <!-- Test sync -->
      <button class="btn btn-outline-info btn-sm" on:click={() => doSync(inv.id)}>
        <i class="bi bi-wifi me-1"></i>Test Sync
      </button>
      {#if syncResults[inv.id]}
        <span class="badge bg-{syncResults[inv.id].startsWith('Error') ? 'danger' : 'success'} align-self-center">
          {syncResults[inv.id]}
        </span>
      {/if}

      <!-- Toggle -->
      <form method="POST" action="?/toggle" style="display:inline">
        <input type="hidden" name="id" value={inv.id} />
        <button class="btn btn-sm {inv.enabled ? 'btn-outline-warning' : 'btn-outline-success'}">
          <i class="bi bi-{inv.enabled ? 'pause' : 'play'} me-1"></i>{inv.enabled ? 'Disable' : 'Enable'}
        </button>
      </form>

      <!-- Delete -->
      <form method="POST" action="?/delete" style="display:inline"
            on:submit|preventDefault={e => { if (confirm('Delete this inverter?')) e.target.submit(); }}>
        <input type="hidden" name="id" value={inv.id} />
        <button class="btn btn-sm btn-outline-danger">
          <i class="bi bi-trash me-1"></i>Delete
        </button>
      </form>
    </div>
  </div>
</div>
{/each}

<!-- Add new inverter -->
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold">
    <i class="bi bi-plus-circle me-2"></i>Add Inverter
  </div>
  <div class="card-body">
    <form method="POST" action="?/add">
      <div class="row g-2 mb-2">
        <div class="col-12 col-md-3">
          <label class="form-label form-label-sm">Name *</label>
          <input name="name" class="form-control form-control-sm" placeholder="e.g. Dach" required />
        </div>
        <div class="col-12 col-md-4">
          <label class="form-label form-label-sm">Full URL</label>
          <input name="full_url" class="form-control form-control-sm"
                 placeholder="http://192.168.1.x/api/livedata/status" />
        </div>
        <div class="col-12 col-md-3">
          <label class="form-label form-label-sm">Nginx Path</label>
          <input name="api_path" class="form-control form-control-sm" placeholder="opendtu_dach/" />
        </div>
        <div class="col-6 col-md-1">
          <label class="form-label form-label-sm">Color</label>
          <input name="color" type="color" class="form-control form-control-sm form-control-color"
                 value="#9b59b6" />
        </div>
      </div>
      <button class="btn btn-success btn-sm">
        <i class="bi bi-plus me-1"></i>Add
      </button>
    </form>
  </div>
</div>
