<script>
  export let form;
</script>

<svelte:head><title>Login – BKW</title></svelte:head>

<div class="min-vh-100 d-flex align-items-center justify-content-center login-bg" style="margin:-1rem -1rem 0">
  <div class="card bkw-login-card shadow-lg p-4" style="width:100%;max-width:380px">
    <div class="text-center mb-4">
      <i class="bi bi-sun-fill text-warning" style="font-size:2.5rem"></i>
      <h4 class="fw-bold mt-2">BKW Dashboard</h4>
      <small class="text-muted">Solar Monitoring</small>
    </div>
    {#if form?.error}
      <div class="alert alert-danger py-2">{form.error}</div>
    {/if}
    <form method="POST">
      <div class="mb-3">
        <label class="form-label fw-semibold" for="username">Username</label>
        <input id="username" name="username" class="form-control" required />
      </div>
      <div class="mb-4">
        <label class="form-label fw-semibold" for="password">Password</label>
        <input id="password" name="password" type="password" class="form-control" required />
      </div>
      <button class="btn btn-warning w-100 fw-bold">
        <i class="bi bi-box-arrow-in-right me-2"></i>Login
      </button>
    </form>
  </div>
</div>
