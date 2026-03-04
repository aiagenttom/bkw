<script>
  import { enhance } from '$app/forms';
  export let data, form;

  let { inverters, profiles } = data;
  const dayNames = ['Mo','Di','Mi','Do','Fr','Sa','So'];
  const maxKw = 2;
  const barHeight = 180; // px

  // State
  let selInvId = inverters[0]?.id || 0;
  let selDay = 0; // 0=Mo
  let isDragging = false;
  let dirty = false;

  // Deep-clone profiles so we can mutate
  let editData = JSON.parse(JSON.stringify(profiles));

  $: currentBars = editData[selInvId]?.[selDay] || new Array(24).fill(0);
  $: selInv = inverters.find(i => i.id === selInvId);

  function getKwFromY(e, container) {
    const rect = container.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const ratio = 1 - Math.max(0, Math.min(1, y / rect.height));
    return Math.round(ratio * maxKw * 20) / 20; // 0.05 steps
  }

  function handleBarEvent(e, hour) {
    const container = e.currentTarget;
    const kw = getKwFromY(e, container);
    editData[selInvId][selDay][hour] = kw;
    editData = editData; // trigger reactivity
    dirty = true;
  }

  function onMouseDown(e, hour) {
    isDragging = true;
    handleBarEvent(e, hour);
  }

  function onMouseMove(e, hour) {
    if (!isDragging) return;
    handleBarEvent(e, hour);
  }

  function onMouseUp() {
    isDragging = false;
  }

  function copyDay(fromDay, toDays) {
    for (const td of toDays) {
      editData[selInvId][td] = [...editData[selInvId][fromDay]];
    }
    editData = editData;
    dirty = true;
  }

  function clearDay() {
    editData[selInvId][selDay] = new Array(24).fill(0);
    editData = editData;
    dirty = true;
  }

  // After successful save
  $: if (form?.success) { dirty = false; }
</script>

<svelte:head><title>Verbrauchsprofil – BKW</title></svelte:head>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div on:mouseup={onMouseUp} on:mouseleave={onMouseUp}>

<div class="d-flex justify-content-between align-items-center mb-4">
  <h4 class="fw-bold mb-0"><i class="bi bi-bar-chart-steps me-2"></i>Verbrauchsprofil</h4>
  <a href="/admin" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-left me-1"></i>Back</a>
</div>

{#if form?.success}<div class="alert alert-success py-2 small">{form.success}</div>{/if}
{#if form?.error}<div class="alert alert-danger py-2 small">{form.error}</div>{/if}

<!-- Inverter selector -->
<div class="d-flex gap-2 mb-3 flex-wrap">
  {#each inverters as inv}
    <button class="btn btn-sm {selInvId === inv.id ? 'btn-primary' : 'btn-outline-secondary'}"
            on:click={() => { selInvId = inv.id; }}>
      <span class="d-inline-block rounded-circle me-1" style="width:10px;height:10px;background:{inv.color}"></span>
      {inv.name}
    </button>
  {/each}
</div>

<!-- Weekday tabs -->
<div class="d-flex gap-1 mb-3">
  {#each dayNames as dn, i}
    <button class="btn btn-sm {selDay === i ? 'btn-warning' : 'btn-outline-secondary'}"
            on:click={() => { selDay = i; }}>
      {dn}
    </button>
  {/each}
</div>

<!-- Bar chart editor -->
<div class="card shadow-sm mb-3">
  <div class="card-header d-flex justify-content-between align-items-center py-2">
    <span class="fw-semibold small">
      <span class="d-inline-block rounded-circle me-1" style="width:10px;height:10px;background:{selInv?.color || '#3498db'}"></span>
      {selInv?.name || '–'} — {dayNames[selDay]} — Geschätzte Nutzung (kW)
    </span>
    <span class="small text-muted">Max: {maxKw} kW | Klicken/Ziehen zum Einstellen</span>
  </div>
  <div class="card-body p-3">
    <!-- Y-axis scale + bars -->
    <div class="d-flex">
      <!-- Y-axis labels -->
      <div class="d-flex flex-column justify-content-between me-2" style="height:{barHeight}px;min-width:30px">
        <small class="text-muted text-end">{maxKw}</small>
        <small class="text-muted text-end">{maxKw * 0.75}</small>
        <small class="text-muted text-end">{maxKw * 0.5}</small>
        <small class="text-muted text-end">{maxKw * 0.25}</small>
        <small class="text-muted text-end">0</small>
      </div>

      <!-- Bars container -->
      <div class="d-flex flex-grow-1 gap-0 align-items-end position-relative"
           style="height:{barHeight}px;border-bottom:2px solid #dee2e6;border-left:1px solid #dee2e6">

        <!-- Grid lines -->
        {#each [0.25, 0.5, 0.75, 1] as frac}
          <div class="position-absolute w-100" style="bottom:{frac * 100}%;border-top:1px dashed #eee;left:0;pointer-events:none"></div>
        {/each}

        {#each currentBars as kw, hour}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="flex-fill position-relative"
               style="height:100%;cursor:pointer;user-select:none"
               on:mousedown={(e) => onMouseDown(e, hour)}
               on:mousemove={(e) => onMouseMove(e, hour)}>
            <!-- The filled bar -->
            <div class="position-absolute bottom-0 w-100 d-flex align-items-start justify-content-center"
                 style="height:{Math.max(kw / maxKw * 100, 0)}%;
                        background:{selInv?.color || '#3498db'};
                        opacity:0.75;
                        transition:height 0.05s;
                        border-radius:2px 2px 0 0;
                        margin:0 1px;
                        pointer-events:none">
              {#if kw > 0}
                <small class="text-white fw-bold" style="font-size:.55rem;margin-top:2px;pointer-events:none">{kw.toFixed(1)}</small>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Hour labels -->
    <div class="d-flex" style="margin-left:32px">
      {#each Array(24) as _, h}
        <div class="flex-fill text-center">
          <small class="text-muted" style="font-size:.6rem">{String(h).padStart(2,'0')}</small>
        </div>
      {/each}
    </div>
  </div>
</div>

<!-- Actions -->
<div class="d-flex gap-2 flex-wrap mb-4">
  <!-- Save -->
  <form method="POST" action="?/saveProfile" use:enhance={({ formData }) => {
    formData.set('inverter_id', String(selInvId));
    formData.set('data', JSON.stringify(editData[selInvId] || {}));
    return async ({ result, update }) => {
      await update();
    };
  }}>
    <input type="hidden" name="inverter_id" value={selInvId} />
    <input type="hidden" name="data" value={JSON.stringify(editData[selInvId] || {})} />
    <button class="btn btn-primary btn-sm" disabled={!dirty}>
      <i class="bi bi-save me-1"></i>Speichern {dirty ? '●' : ''}
    </button>
  </form>

  <!-- Copy day -->
  <div class="dropdown">
    <button class="btn btn-outline-secondary btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown">
      <i class="bi bi-clipboard me-1"></i>{dayNames[selDay]} kopieren nach…
    </button>
    <ul class="dropdown-menu dropdown-menu-dark">
      <li><button class="dropdown-item" on:click={() => copyDay(selDay, [0,1,2,3,4])}>Mo–Fr (Werktage)</button></li>
      <li><button class="dropdown-item" on:click={() => copyDay(selDay, [5,6])}>Sa–So (Wochenende)</button></li>
      <li><button class="dropdown-item" on:click={() => copyDay(selDay, [0,1,2,3,4,5,6])}>Alle Tage</button></li>
      <li><hr class="dropdown-divider" /></li>
      {#each dayNames as dn, i}
        {#if i !== selDay}
          <li><button class="dropdown-item" on:click={() => copyDay(selDay, [i])}>{dn}</button></li>
        {/if}
      {/each}
    </ul>
  </div>

  <!-- Clear -->
  <button class="btn btn-outline-danger btn-sm" on:click={clearDay}>
    <i class="bi bi-trash me-1"></i>{dayNames[selDay]} zurücksetzen
  </button>
</div>

<!-- Summary -->
<div class="card shadow-sm">
  <div class="card-header fw-semibold small"><i class="bi bi-info-circle me-2"></i>Zusammenfassung – {selInv?.name || '–'}</div>
  <div class="card-body p-0">
    <table class="table table-sm mb-0 small">
      <thead class="table-dark"><tr><th>Tag</th><th class="text-end">Ø kW</th><th class="text-end">Σ kWh/Tag</th></tr></thead>
      <tbody>
        {#each dayNames as dn, i}
          {@const dayData = editData[selInvId]?.[i] || new Array(24).fill(0)}
          {@const sum = dayData.reduce((s, v) => s + v, 0)}
          {@const avg = sum / 24}
          <tr class:table-warning={i === selDay}>
            <td>{dn}</td>
            <td class="text-end">{avg.toFixed(2)}</td>
            <td class="text-end fw-bold">{sum.toFixed(1)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

</div>
