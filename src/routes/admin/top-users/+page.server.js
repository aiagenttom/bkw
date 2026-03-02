import db from '$lib/db.js';

export async function load({ url }) {
  const tf = parseInt(url.searchParams.get('timeframe') || '1');
  const users = db.prepare(`
    SELECT username, COUNT(*) AS page_events, ROUND(AVG(elapsed_ms),1) AS avg_elapsed,
           SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors, MAX(created_at) AS most_recent
    FROM activity_log WHERE created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY username ORDER BY page_events DESC LIMIT 50
  `).all(tf);
  return { users, tf };
}
