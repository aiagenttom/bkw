import db from '$lib/db.js';
export async function load({ url }) {
  const tf = parseInt(url.searchParams.get('timeframe') || '7');
  const errors = db.prepare(`
    SELECT id, username, page_path, method, status_code, error_message, created_at
    FROM activity_log WHERE status_code >= 400 AND created_at >= datetime('now', '-' || ? || ' days')
    ORDER BY created_at DESC LIMIT 200
  `).all(tf);
  const timezone = db.prepare("SELECT value FROM app_settings WHERE key = 'timezone'").get()?.value || 'Europe/Vienna';
  return { errors, tf, timezone };
}
