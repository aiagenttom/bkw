import db from '$lib/db.js';
import { error } from '@sveltejs/kit';
export async function load({ params }) {
  const entry = db.prepare('SELECT * FROM automation_log WHERE id = ?').get(parseInt(params.id));
  if (!entry) throw error(404, 'Not found');
  const messages = db.prepare('SELECT * FROM automation_msg_log WHERE log_id = ? ORDER BY msg_timestamp').all(entry.id);
  return { entry, messages };
}
