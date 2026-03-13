<script>
  export let data, form;
  const { inverters } = data;
  let pbByInverter = data.pbByInverter;
  let ankerConfig  = data.ankerConfig;
  let configReady  = data.configReady;
  let lastReading  = data.lastReading;

  // Passwort-Feld: leer lassen = altes Passwort behalten
  let showPassword = false;

  function timeAgo(ts) {
    if (!ts) return null;
    const diff = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60)   return `vor ${diff}s`;
    if (diff < 3600) return `vor ${Math.floor(diff / 60)} min`;
    return `vor ${Math.floor(diff / 3600)} h`;
  }
</script>

<svelte:head><title>Stromspeicher – BKW Admin</title></svelte:head>

<div class="d-flex justify-content-between align-items-center mb-4">
  <div>
    <h4 class="fw-bold mb-0"><i class="bi bi-battery-charging me-2"></i>Stromspeicher / Powerbank</h4>
    <small class="text-muted">Simulierte Ersparnis &amp; Anker SOLIX Live-Anbindung</small>
  </div>
  <div class="d-flex gap-2">
    <a href="/powerbank" class="btn btn-outline-primary btn-sm"><i class="bi bi-battery-half me-1"></i>Live-Ansicht</a>
    <a href="/admin" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-left me-1"></i>Zurück</a>
  </div>
</div>

{#if form?.success}<div class="alert alert-success py-2">{form.success}</div>{/if}
{#if form?.error}<div class="alert alert-danger py-2">{form.error}</div>{/if}

<!-- ══════════════════════════════════════════════════════════════════════ -->
<!-- Abschnitt 1: Simulierte Ersparnis pro Inverter                       -->
<!-- ══════════════════════════════════════════════════════════════════════ -->
<h5 class="fw-semibold mb-3 mt-2"><i class="bi bi-calculator me-2 text-warning"></i>Simulierte Ersparnis</h5>

<div class="alert alert-info py-2 mb-3 small">
  <i class="bi bi-info-circle me-1"></i>
  PV-Überschuss (Ertrag &gt; Profil) wird im Speicher gesammelt und dann konstant abgegeben.
  Ersparnis durch Speicher wird zur profil-basierten Ersparnis addiert.
  <strong>Verbrauchsprofil muss hinterlegt sein.</strong>
</div>

{#each inverters as inv}
{@const pb = pbByInverter[inv.id]}
<div class="card shadow-sm mb-3">
  <div class="card-header fw-semibold d-flex align-items-center gap-2">
    <span class="d-inline-block rounded-circle" style="width:12px;height:12px;background:{inv.color}"></span>
    {inv.name}
    {#if pb?.enabled}
      <span class="badge bg-success ms-auto"><i class="bi bi-battery-charging me-1"></i>Aktiv</span>
    {:else if pb}
      <span class="badge bg-secondary ms-auto">Deaktiviert</span>
    {:else}
      <span class="badge bg-light text-muted ms-auto">Kein Speicher</span>
    {/if}
  </div>
  <div class="card-body">
    <form method="POST" action="?/save">
      <input type="hidden" name="inverter_id" value={inv.id} />
      <div class="row g-3 align-items-end">

        <div class="col-6 col-md-3">
          <label class="form-label form-label-sm fw-semibold" for="cap-{inv.id}">Kapazität</label>
          <div class="input-group input-group-sm">
            <input id="cap-{inv.id}" name="capacity_kwh" type="number" min="0.1" step="0.1"
                   class="form-control form-control-sm"
                   value={pb ? (pb.capacity_wh / 1000).toFixed(1) : '1.6'} placeholder="z.B. 1.6" />
            <span class="input-group-text">kWh</span>
          </div>
        </div>

        <div class="col-6 col-md-3">
          <label class="form-label form-label-sm fw-semibold" for="dis-{inv.id}">Abgabeleistung</label>
          <div class="input-group input-group-sm">
            <input id="dis-{inv.id}" name="discharge_w" type="number" min="1" step="1"
                   class="form-control form-control-sm"
                   value={pb?.discharge_w ?? 200} placeholder="z.B. 200" />
            <span class="input-group-text">W</span>
          </div>
          <div class="text-muted" style="font-size:.7rem">
            {#if pb}≈ {(pb.capacity_wh / pb.discharge_w).toFixed(1)} h voll geladen{/if}
          </div>
        </div>

        <div class="col-6 col-md-2">
          <label class="form-label form-label-sm fw-semibold" for="dstart-{inv.id}">Entladen ab</label>
          <input id="dstart-{inv.id}" name="discharge_start" type="time"
                 class="form-control form-control-sm"
                 value={pb?.discharge_start ?? '00:00'} />
          <div class="text-muted" style="font-size:.7rem">Beginn Entlade-Fenster</div>
        </div>

        <div class="col-6 col-md-2">
          <label class="form-label form-label-sm fw-semibold" for="dend-{inv.id}">Entladen bis</label>
          <input id="dend-{inv.id}" name="discharge_end" type="time"
                 class="form-control form-control-sm"
                 value={pb?.discharge_end ?? '23:59'} />
          <div class="text-muted" style="font-size:.7rem">Ende Entlade-Fenster</div>
        </div>

        <div class="col-6 col-md-2">
          <label class="form-label form-label-sm fw-semibold">Status</label>
          <select name="enabled" class="form-select form-select-sm">
            <option value="1" selected={!pb || pb.enabled === 1}>Aktiv</option>
            <option value="0" selected={pb?.enabled === 0}>Deaktiviert</option>
          </select>
        </div>

        <div class="col-6 col-md-2 d-flex align-items-end">
          <button class="btn btn-primary btn-sm w-100"><i class="bi bi-save me-1"></i>Speichern</button>
        </div>

        {#if pb}
        <div class="col-12 col-md-2 d-flex align-items-end">
          <form method="POST" action="?/delete" class="w-100"
                on:submit|preventDefault={e => { if (confirm('Powerbank für ' + inv.name + ' löschen?')) e.target.submit(); }}>
            <input type="hidden" name="inverter_id" value={inv.id} />
            <button class="btn btn-outline-danger btn-sm w-100"><i class="bi bi-trash me-1"></i>Entfernen</button>
          </form>
        </div>
        {/if}
      </div>
    </form>

    {#if pb?.enabled}
    <div class="mt-3 p-2 rounded" style="background:var(--bs-light)">
      <small class="text-muted">
        <i class="bi bi-sun me-1 text-warning"></i>PV-Überschuss → Speicher ({(pb.capacity_wh/1000).toFixed(1)} kWh)
        → <i class="bi bi-house me-1"></i>Haushalt ({pb.discharge_w} W konstant)
        | Max. Laufzeit: {(pb.capacity_wh / pb.discharge_w).toFixed(1)} h
        {#if pb.discharge_start !== '00:00' || pb.discharge_end !== '23:59'}
          | <i class="bi bi-clock me-1"></i>Entladen nur {pb.discharge_start}–{pb.discharge_end}
        {/if}
      </small>
    </div>
    {/if}
  </div>
</div>
{/each}

<!-- ══════════════════════════════════════════════════════════════════════ -->
<!-- Abschnitt 2: Anker SOLIX Live-Anbindung                              -->
<!-- ══════════════════════════════════════════════════════════════════════ -->
<hr class="my-4" />
<h5 class="fw-semibold mb-3"><i class="bi bi-cloud-arrow-down me-2 text-info"></i>Anker SOLIX Live-Anbindung</h5>

<!-- Status-Badge -->
<div class="d-flex align-items-center gap-3 mb-3 flex-wrap">
  {#if configReady}
    <span class="badge bg-success fs-6">
      <i class="bi bi-circle-fill me-1" style="font-size:.6rem"></i>
      Konfiguriert &amp; aktiv
      {#if lastReading}· letzter Abruf {timeAgo(lastReading)}{/if}
    </span>
  {:else}
    <span class="badge bg-warning text-dark fs-6">
      <i class="bi bi-circle-fill me-1" style="font-size:.6rem"></i>
      Nicht konfiguriert
    </span>
  {/if}
  <a href="/powerbank" class="btn btn-outline-primary btn-sm">
    <i class="bi bi-battery-half me-1"></i>Live-Ansicht öffnen
  </a>
  {#if configReady}
  <a href="/api/anker-status" target="_blank" class="btn btn-outline-secondary btn-sm">
    <i class="bi bi-bug me-1"></i>API-Test
  </a>
  {/if}
</div>

<!-- Info: Kein Python nötig -->
<div class="alert alert-success py-2 mb-3 small">
  <i class="bi bi-check-circle me-1"></i>
  <strong>Node.js nativ – kein Python nötig.</strong>
  Die Anbindung läuft direkt im BKW-Backend via ECDH-Schlüsselaustausch + AES-256-CBC.
  Einfach E-Mail und Passwort des Anker-Kontos eingeben und speichern.
</div>

<!-- Einstellungsformular -->
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold"><i class="bi bi-gear me-2"></i>Anker-Konfiguration</div>
  <div class="card-body">
    <form method="POST" action="?/saveAnker">
      <div class="row g-3">

        <div class="col-12">
          <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" name="anker_enabled" value="1"
                   id="anker-enabled" checked={ankerConfig.enabled} />
            <label class="form-check-label fw-semibold" for="anker-enabled">
              Anker SOLIX Live-Daten aktivieren
            </label>
          </div>
        </div>

        <div class="col-12 col-md-5">
          <label class="form-label form-label-sm fw-semibold" for="anker-email">Anker-Konto E-Mail</label>
          <input id="anker-email" name="anker_email" type="email" class="form-control form-control-sm"
                 value={ankerConfig.email || ''} placeholder="deine@email.at" autocomplete="off" />
        </div>

        <div class="col-12 col-md-4">
          <label class="form-label form-label-sm fw-semibold" for="anker-pw">Passwort</label>
          <div class="input-group input-group-sm">
            <input id="anker-pw" name="anker_password"
                   type={showPassword ? 'text' : 'password'}
                   class="form-control form-control-sm"
                   value=""
                   placeholder={ankerConfig.email ? '(unverändert lassen = bleibt gespeichert)' : ''} autocomplete="new-password" />
            <button type="button" class="btn btn-outline-secondary btn-sm"
                    on:click={() => showPassword = !showPassword}>
              <i class="bi bi-{showPassword ? 'eye-slash' : 'eye'}"></i>
            </button>
          </div>
          <div class="text-muted" style="font-size:.7rem">Leer lassen = gespeichertes Passwort bleibt erhalten</div>
        </div>

        <div class="col-6 col-md-3">
          <label class="form-label form-label-sm fw-semibold" for="anker-country">Land</label>
          <select id="anker-country" name="anker_country" class="form-select form-select-sm">
            <option value="de" selected={ankerConfig.country === 'de' || !ankerConfig.country}>Deutschland (de)</option>
            <option value="at" selected={ankerConfig.country === 'at'}>Österreich (at)</option>
            <option value="com" selected={ankerConfig.country === 'com'}>International (com)</option>
            <option value="eu" selected={ankerConfig.country === 'eu'}>EU (eu)</option>
          </select>
        </div>

        <div class="col-12 col-md-9">
          <label class="form-label form-label-sm fw-semibold" for="anker-sn">
            Seriennummer (optional)
          </label>
          <input id="anker-sn" name="anker_device_sn" type="text" class="form-control form-control-sm"
                 value={ankerConfig.device_sn || ''} placeholder="Leer = erstes Gerät automatisch" />
          <div class="text-muted" style="font-size:.7rem">Steht auf dem Gerät oder in der Anker App</div>
        </div>

        <div class="col-12">
          <button class="btn btn-primary btn-sm">
            <i class="bi bi-save me-1"></i>Anker-Einstellungen speichern
          </button>
          {#if configReady}
          <a href="/api/anker-status?dump=1" target="_blank" class="btn btn-outline-secondary btn-sm ms-2">
            <i class="bi bi-code-slash me-1"></i>Rohdaten-Dump (Fehlersuche)
          </a>
          {/if}
        </div>

      </div>
    </form>
  </div>
</div>
