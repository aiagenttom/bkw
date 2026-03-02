<script>
  export let data, form;
</script>

<svelte:head><title>Users – BKW</title></svelte:head>
<div class="d-flex justify-content-between align-items-center mb-4">
  <h4 class="fw-bold mb-0"><i class="bi bi-person-gear me-2"></i>Users</h4>
  <a href="/admin" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-left me-1"></i>Back</a>
</div>

{#if form?.success}<div class="alert alert-success py-2">{form.success}</div>{/if}
{#if form?.error}<div class="alert alert-danger py-2">{form.error}</div>{/if}

<!-- Add user -->
<div class="card shadow-sm mb-4">
  <div class="card-header fw-semibold"><i class="bi bi-person-plus me-2"></i>Add User</div>
  <div class="card-body">
    <form method="POST" action="?/add">
      <div class="row g-2">
        <div class="col-6 col-md-3">
          <input name="username" class="form-control form-control-sm" placeholder="Username" required />
        </div>
        <div class="col-6 col-md-3">
          <input name="password" type="password" class="form-control form-control-sm" placeholder="Password" required />
        </div>
        <div class="col-6 col-md-3">
          <input name="email" type="email" class="form-control form-control-sm" placeholder="Email" />
        </div>
        <div class="col-6 col-md-2 d-flex align-items-center gap-2">
          <input name="is_admin" type="checkbox" class="form-check-input" id="chkAdmin" />
          <label class="form-check-label small" for="chkAdmin">Admin</label>
        </div>
        <div class="col-12 col-md-1">
          <button class="btn btn-success btn-sm w-100" aria-label="Add user"><i class="bi bi-plus"></i></button>
        </div>
      </div>
    </form>
  </div>
</div>

<!-- Users table -->
<div class="card shadow-sm">
  <div class="card-body p-0">
    <div class="table-responsive">
      <table class="table table-sm table-hover mb-0">
        <thead class="table-dark">
          <tr>
            <th>Username</th><th>Email</th><th>Role</th>
            <th>Created</th><th>Last Login</th><th></th>
          </tr>
        </thead>
        <tbody>
          {#each data.users as u}
          <tr>
            <td class="fw-semibold">{u.username}</td>
            <td class="text-muted">{u.email || '–'}</td>
            <td>
              {#if u.is_admin}
                <span class="badge bg-warning text-dark">Admin</span>
              {:else}
                <span class="badge bg-secondary">User</span>
              {/if}
            </td>
            <td class="text-muted small">{u.created_at?.substring(0,10) || '–'}</td>
            <td class="text-muted small">{u.last_login?.substring(0,16) || '–'}</td>
            <td>
              <form method="POST" action="?/delete"
                    on:submit|preventDefault={e => { if(confirm('Delete user?')) e.target.submit(); }}>
                <input type="hidden" name="id" value={u.id} />
                <button class="btn btn-outline-danger btn-sm py-0" aria-label="Delete user">
                  <i class="bi bi-trash"></i>
                </button>
              </form>
            </td>
          </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
