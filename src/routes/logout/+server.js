import { redirect } from '@sveltejs/kit';
import { destroySession } from '$lib/session.js';

export function GET({ cookies }) {
  destroySession(cookies);
  throw redirect(302, '/login');
}
