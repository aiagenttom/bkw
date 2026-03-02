<script>
  import { page } from '$app/stores';
  export let data;
  $: user    = data.user;
  $: isAdmin = user?.isAdmin;
  $: path    = $page.url.pathname;
</script>

<nav class="navbar navbar-expand navbar-dark bkw-navbar">
  <div class="container-fluid px-3">
    <a class="navbar-brand fw-bold" href="/">
      <i class="bi bi-sun-fill text-warning me-1"></i>BKW
    </a>
    <div class="navbar-collapse">
      <ul class="navbar-nav me-auto">
        <li class="nav-item">
          <a class="nav-link" class:active={path === '/'} href="/">
            <i class="bi bi-speedometer2 me-1"></i>Dashboard
          </a>
        </li>
        <li class="nav-item">
          <a class="nav-link" class:active={path.startsWith('/history')} href="/history">
            <i class="bi bi-bar-chart-fill me-1"></i>Verlauf
          </a>
        </li>
        {#if isAdmin}
        <li class="nav-item dropdown">
          <button class="nav-link dropdown-toggle btn btn-link p-0" class:active={path.startsWith('/admin')}
                  type="button" data-bs-toggle="dropdown" aria-expanded="false">
            <i class="bi bi-gear-fill me-1"></i>Admin
          </button>
          <ul class="dropdown-menu dropdown-menu-dark">
            <li><a class="dropdown-item" href="/admin"><i class="bi bi-house me-2"></i>Overview</a></li>
            <li><hr class="dropdown-divider" /></li>
            <li><a class="dropdown-item" href="/admin/activity"><i class="bi bi-bar-chart me-2"></i>Activity</a></li>
            <li><a class="dropdown-item" href="/admin/top-users"><i class="bi bi-people me-2"></i>Top Users</a></li>
            <li><a class="dropdown-item" href="/admin/error-log"><i class="bi bi-exclamation-triangle me-2"></i>Error Log</a></li>
            <li><a class="dropdown-item" href="/admin/page-performance"><i class="bi bi-speedometer me-2"></i>Performance</a></li>
            <li><a class="dropdown-item" href="/admin/page-views"><i class="bi bi-eye me-2"></i>Page Views</a></li>
            <li><a class="dropdown-item" href="/admin/automations"><i class="bi bi-arrow-repeat me-2"></i>Automations</a></li>
            <li><a class="dropdown-item" href="/admin/daily"><i class="bi bi-calendar3 me-2"></i>Daily History</a></li>
            <li><hr class="dropdown-divider" /></li>
            <li><a class="dropdown-item" href="/admin/inverters"><i class="bi bi-lightning me-2"></i>Inverters</a></li>
            <li><a class="dropdown-item" href="/admin/smartmeter"><i class="bi bi-file-earmark-spreadsheet me-2"></i>Smart Meter</a></li>
            <li><a class="dropdown-item" href="/admin/users"><i class="bi bi-person-gear me-2"></i>Users</a></li>
          </ul>
        </li>
        {/if}
      </ul>
      <ul class="navbar-nav ms-auto align-items-center">
        {#if user}
          <li class="nav-item me-2">
            <span class="navbar-text text-light">
              <i class="bi bi-person-circle me-1"></i>{user.username}
            </span>
          </li>
          <li class="nav-item">
            <a class="btn btn-outline-light btn-sm" href="/logout">
              <i class="bi bi-box-arrow-right me-1"></i>Logout
            </a>
          </li>
        {:else}
          <li class="nav-item">
            <a class="btn btn-outline-light btn-sm" href="/login">
              <i class="bi bi-box-arrow-in-right me-1"></i>Login
            </a>
          </li>
        {/if}
      </ul>
    </div><!-- /.navbar-collapse -->
  </div><!-- /.container-fluid -->
</nav>

<main class="container-fluid py-3 px-3 px-lg-4">
  <slot />
</main>

<footer class="text-center text-muted py-3 mt-4 border-top">
  <small><i class="bi bi-sun-fill text-warning"></i> BKW Solar Dashboard — SvelteKit + SQLite</small>
</footer>
