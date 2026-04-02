<script>
  // Props: energy values in Wh for today
  export let pvWh           = 0;   // PV yield
  export let battChargeWh   = 0;   // Battery charged (from PV)
  export let battDischargeWh = 0;  // Battery discharged (to home)
  export let consumptionWh  = 0;   // Household consumption (from Shelly etc.)

  // SVG layout constants
  const VW   = 580;   // viewBox width
  const VH   = 260;   // viewBox height
  const NW   = 14;    // node bar width
  const NX_L = 140;   // left node x (label area = 0..140)
  const NX_R = 426;   // right node x (= VW - 140 - NW)
  const PAD  = 10;    // gap between nodes on same side
  const CX   = (NX_L + NW + NX_R) / 2;  // bezier control x

  function fmtWh(wh) {
    if (!wh || wh < 2) return '–';
    return wh >= 1000
      ? (wh / 1000).toFixed(2) + ' kWh'
      : Math.round(wh) + ' Wh';
  }
  function pct(part, total) {
    if (!total || !part) return '';
    return ' (' + Math.round(part / total * 100) + '%)';
  }

  // Recompute layout whenever props change
  $: layout = computeLayout(pvWh, battChargeWh, battDischargeWh, consumptionWh);

  function computeLayout(pv, battCh, battDisch, consump) {
    // Derived flows
    const gridExport = Math.max(0, pv + battDisch - consump - battCh);
    const gridImport = Math.max(0, consump + battCh - pv - battDisch);
    const pvToCons   = Math.max(0, pv - battCh - gridExport);

    const totalSrc = pv + battDisch + gridImport;
    const totalSnk = battCh + consump + gridExport;
    if (!totalSrc || !totalSnk) return { srcs: [], snks: [], links: [], empty: true };

    // Source nodes (left)
    const srcs = [];
    if (pv > 0)         srcs.push({ id: 'pv',       label: 'PV',          value: pv,         color: '#facc15' });
    if (battDisch > 0)  srcs.push({ id: 'batt_out',  label: 'Batterie',    value: battDisch,   color: '#22d3ee' });
    if (gridImport > 0) srcs.push({ id: 'grid_in',   label: 'Stromnetz',   value: gridImport,  color: '#60a5fa' });

    // Sink nodes (right)
    const snks = [];
    if (battCh > 0)     snks.push({ id: 'batt_in',   label: 'Batterie',    value: battCh,      color: '#22d3ee' });
    if (consump > 0)    snks.push({ id: 'load',       label: 'Verbrauch',   value: consump,     color: '#a78bfa' });
    if (gridExport > 0) snks.push({ id: 'grid_out',   label: 'Einspeisung', value: gridExport,  color: '#34d399' });

    // Scale each side to fill VH
    const srcScale = (VH - PAD * Math.max(0, srcs.length - 1)) / totalSrc;
    const snkScale = (VH - PAD * Math.max(0, snks.length - 1)) / totalSnk;

    let y = 0;
    for (const n of srcs) {
      n.x0 = NX_L; n.x1 = NX_L + NW;
      n.y0 = y; n.y1 = y + n.value * srcScale;
      n.yMid = (n.y0 + n.y1) / 2;
      y = n.y1 + PAD;
    }
    y = 0;
    for (const n of snks) {
      n.x0 = NX_R; n.x1 = NX_R + NW;
      n.y0 = y; n.y1 = y + n.value * snkScale;
      n.yMid = (n.y0 + n.y1) / 2;
      y = n.y1 + PAD;
    }

    // Build ribbon links
    const srcOff = Object.fromEntries(srcs.map(n => [n.id, n.y0]));
    const snkOff = Object.fromEntries(snks.map(n => [n.id, n.y0]));

    const links = [];
    const addLink = (srcId, snkId, value) => {
      if (!value || value < 2) return;
      const src = srcs.find(n => n.id === srcId);
      const snk = snks.find(n => n.id === snkId);
      if (!src || !snk) return;
      const sh = value * srcScale, th = value * snkScale;
      const sy0 = srcOff[srcId]; srcOff[srcId] += sh;
      const ty0 = snkOff[snkId]; snkOff[snkId] += th;
      links.push({
        sy0, sy1: sy0 + sh,
        ty0, ty1: ty0 + th,
        srcColor: src.color, snkColor: snk.color,
        tooltip: src.label + ' → ' + snk.label + ': ' + fmtWh(value) + pct(value, totalSrc),
        id: srcId + '-' + snkId,
      });
    };

    // PV flows (charge first, then direct consumption, then export)
    addLink('pv',       'batt_in',  battCh);
    addLink('pv',       'load',     pvToCons);
    addLink('pv',       'grid_out', gridExport);
    addLink('batt_out', 'load',     battDisch);
    addLink('grid_in',  'load',     gridImport);

    return { srcs, snks, links, empty: false };
  }

  // SVG ribbon path (S-curve)
  function ribbon(l) {
    return [
      `M ${NX_L + NW},${l.sy0}`,
      `C ${CX},${l.sy0} ${CX},${l.ty0} ${NX_R},${l.ty0}`,
      `L ${NX_R},${l.ty1}`,
      `C ${CX},${l.ty1} ${CX},${l.sy1} ${NX_L + NW},${l.sy1}`,
      'Z',
    ].join(' ');
  }

  let hoverId = null;
  // Unique prefix for gradient IDs (avoids collisions if mounted multiple times)
  const uid = Math.random().toString(36).slice(2, 7);
</script>

{#if layout.empty}
  <div class="text-muted text-center py-4" style="font-size:.85rem">
    <i class="bi bi-info-circle me-1"></i>Noch keine Energiedaten für heute vorhanden.
  </div>
{:else}
<div style="width:100%;overflow:hidden">
  <svg viewBox="0 0 {VW} {VH}" width="100%" style="display:block;overflow:visible">
    <defs>
      {#each layout.links as l (l.id)}
        <linearGradient
          id="sg_{uid}_{l.id}"
          gradientUnits="userSpaceOnUse"
          x1={NX_L + NW} x2={NX_R}
        >
          <stop offset="0%"   stop-color={l.srcColor} stop-opacity="0.55"/>
          <stop offset="100%" stop-color={l.snkColor} stop-opacity="0.55"/>
        </linearGradient>
      {/each}
    </defs>

    <!-- Ribbon flows -->
    {#each layout.links as l (l.id)}
      <path
        d={ribbon(l)}
        fill="url(#sg_{uid}_{l.id})"
        stroke="none"
        style="cursor:pointer;transition:opacity .15s"
        opacity={hoverId === null || hoverId === l.id ? 1 : 0.25}
        on:mouseenter={() => hoverId = l.id}
        on:mouseleave={() => hoverId = null}
      ><title>{l.tooltip}</title></path>
    {/each}

    <!-- Source node bars + labels -->
    {#each layout.srcs as n (n.id)}
      <rect x={n.x0} y={n.y0} width={NW} height={n.y1 - n.y0} rx="4"
            fill={n.color} opacity="0.9"/>
      <text x={NX_L - 8} y={n.yMid - 6} text-anchor="end"
            font-size="11" font-weight="700" fill="#e2e8f0" font-family="system-ui,sans-serif">
        {n.label}
      </text>
      <text x={NX_L - 8} y={n.yMid + 8} text-anchor="end"
            font-size="10" fill="#94a3b8" font-family="system-ui,sans-serif">
        {fmtWh(n.value)}
      </text>
    {/each}

    <!-- Sink node bars + labels -->
    {#each layout.snks as n (n.id)}
      <rect x={n.x0} y={n.y0} width={NW} height={n.y1 - n.y0} rx="4"
            fill={n.color} opacity="0.9"/>
      <text x={NX_R + NW + 8} y={n.yMid - 6} text-anchor="start"
            font-size="11" font-weight="700" fill="#e2e8f0" font-family="system-ui,sans-serif">
        {n.label}
      </text>
      <text x={NX_R + NW + 8} y={n.yMid + 8} text-anchor="start"
            font-size="10" fill="#94a3b8" font-family="system-ui,sans-serif">
        {fmtWh(n.value)}
      </text>
    {/each}
  </svg>
</div>
{/if}
