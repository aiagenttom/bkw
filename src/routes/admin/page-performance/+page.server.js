import db from '$lib/db.js';
export async function load({ url }) {
  const tf = parseInt(url.searchParams.get('timeframe') || '1');
  const pages = db.prepare(`
    SELECT page_path, COUNT(*) AS page_views, ROUND(AVG(elapsed_ms),1) AS avg_elapsed,
           MAX(elapsed_ms) AS max_elapsed, MIN(elapsed_ms) AS min_elapsed,
           COUNT(DISTINCT username) AS distinct_users,
           SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors
    FROM activity_log WHERE created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY page_path ORDER BY avg_elapsed DESC LIMIT 50
  `).all(tf);
  return { pages, tf };
}
