<svelte:head><title>Admin – BKW</title></svelte:head>

<h4 class="fw-bold mb-4"><i class="bi bi-gear-fill me-2"></i>Administration</h4>

<div class="row g-3">
  {#each [
    ['/admin/activity',         'bi-bar-chart',              'Activity Dashboard', 'Request stats & charts'],
    ['/admin/top-users',        'bi-people',                 'Top Users',          'Most active users'],
    ['/admin/error-log',        'bi-exclamation-triangle',   'Error Log',          '4xx / 5xx responses'],
    ['/admin/page-performance', 'bi-speedometer',            'Page Performance',   'Slowest pages'],
    ['/admin/page-views',       'bi-eye',                    'Page Views',         'Full access log'],
    ['/admin/automations',      'bi-arrow-repeat',           'Automations',        'Sync run history'],
    ['/admin/daily',            'bi-calendar3',              'Daily History',       'Yield per day & month'],
    ['/admin/inverters',        'bi-lightning',              'Inverter Settings',  'API endpoints & colors'],
    ['/admin/powerbank',        'bi-battery-charging',       'Stromspeicher',      'Powerbank pro Inverter'],
    ['/admin/smartmeter',       'bi-file-earmark-spreadsheet','Smart Meter',       'CSV import'],
    ['/admin/users',            'bi-person-gear',            'Users',              'Manage accounts'],
  ] as [href, icon, title, desc]}
  <div class="col-6 col-md-4 col-xl-3">
    <a href={href} class="card bkw-admin-card text-decoration-none p-3 d-block">
      <i class="bi {icon} fs-4 text-warning mb-2 d-block"></i>
      <div class="fw-semibold">{title}</div>
      <small class="text-muted">{desc}</small>
    </a>
  </div>
  {/each}
</div>
