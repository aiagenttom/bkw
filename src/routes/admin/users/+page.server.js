import { fail } from '@sveltejs/kit';
import bcrypt from 'bcryptjs';
import db from '$lib/db.js';

export async function load() {
  return { users: db.prepare('SELECT id, username, email, is_admin, created_at, last_login FROM users ORDER BY created_at').all() };
}

export const actions = {
  add: async ({ request }) => {
    const d = await request.formData();
    const username = d.get('username')?.toString().trim();
    const password = d.get('password')?.toString();
    if (!username || !password) return fail(400, { error: 'Username and password required' });
    try {
      db.prepare('INSERT INTO users (username, password, email, is_admin) VALUES (?,?,?,?)')
        .run(username, bcrypt.hashSync(password, 10), d.get('email')?.toString().trim() || null,
             d.get('is_admin') ? 1 : 0);
    } catch (e) { return fail(400, { error: e.message }); }
    return { success: `User ${username} created` };
  },

  delete: async ({ request, locals }) => {
    const d  = await request.formData();
    const id = parseInt(d.get('id'));
    if (id === locals.user?.userId) return fail(400, { error: 'Cannot delete yourself' });
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return { success: 'User deleted' };
  },
};
