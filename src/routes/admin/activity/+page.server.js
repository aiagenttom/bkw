import db from '$lib/db.js';

export async function load({ url }) {
  const tf = parseInt(url.searchParams.get('timeframe') || '1');

  const hourly = db.prepare(`
    SELECT strftime('%Y-%m-%d %H:00', created_at) AS hour, COUNT(*) AS events
    FROM activity_log WHERE created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY hour ORDER BY hour
  `).all(tf);

  const stats = db.prepare(`
    SELECT COUNT(*) AS total_requests, COUNT(DISTINCT username) AS distinct_users,
           COUNT(DISTINCT session_id) AS sessions,
           ROUND(AVG(elapsed_ms),1) AS avg_elapsed,
           SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors
    FROM activity_log WHERE created_at >= datetime('now', '-' || ? || ' days')
  `).get(tf);

  return { hourly, stats, tf };
}
