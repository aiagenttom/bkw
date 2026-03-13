import db from '$lib/db.js';
export async function load() {
  // LEFT JOIN statt korrelierter Subquery – nutzt idx_automation_msg_log_id
  const logs = db.prepare(`
    SELECT al.id, al.automation_name, al.started_at, al.ended_at, al.status,
           al.successful_rows, al.error_rows,
           COUNT(ml.id) AS msg_count
    FROM (SELECT * FROM automation_log ORDER BY started_at DESC LIMIT 100) al
    LEFT JOIN automation_msg_log ml ON ml.log_id = al.id
    GROUP BY al.id
    ORDER BY al.started_at DESC
  `).all();
  const timezone = db.prepare("SELECT value FROM app_settings WHERE key = 'timezone'").get()?.value || 'Europe/Vienna';
  return { logs, timezone };
}
