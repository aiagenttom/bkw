import db from '$lib/db.js';
export async function load() {
  const logs = db.prepare(`
    SELECT id, automation_name, started_at, ended_at, status,
           successful_rows, error_rows,
           (SELECT COUNT(*) FROM automation_msg_log WHERE log_id = automation_log.id) AS msg_count
    FROM automation_log ORDER BY started_at DESC LIMIT 100
  `).all();
  return { logs };
}
