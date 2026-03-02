import { redirect } from '@sveltejs/kit';

export async function load({ locals }) {
  if (!locals.user?.isAdmin) throw redirect(302, '/login');
  return { user: locals.user };
}
