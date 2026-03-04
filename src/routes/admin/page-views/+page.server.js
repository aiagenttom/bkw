import db from '$lib/db.js';
export async function load({ url }) {
  const tf = parseInt(url.searchParams.get('timeframe') || '1');
  const views = db.prepare(`
    SELECT id, username, page_path, method, elapsed_ms, status_code, created_at, ip_address
    FROM activity_log WHERE created_at >= datetime('now', '-' || ? || ' days')
    ORDER BY created_at DESC LIMIT 500
  `).all(tf);
  const timezone = db.prepare("SELECT value FROM app_settings WHERE key = 'timezone'").get()?.value || 'Europe/Vienna';
  return { views, tf, timezone };
}
