import { fail, redirect } from '@sveltejs/kit';
import bcrypt from 'bcryptjs';
import db from '$lib/db.js';
import { createSession } from '$lib/session.js';

export const actions = {
  default: async ({ request, cookies }) => {
    const data     = await request.formData();
    const username = data.get('username')?.trim();
    const password = data.get('password');

    if (!username || !password)
      return fail(400, { error: 'Username and password required' });

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password))
      return fail(400, { error: 'Invalid username or password' });

    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
    createSession(cookies, { userId: user.id, username: user.username, isAdmin: !!user.is_admin });

    throw redirect(302, '/');
  }
};
