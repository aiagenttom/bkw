import { getSession, pruneSessions } from '$lib/session.js';
import db from '$lib/db.js';
import { syncAll, syncDaily, syncSpottyPrices, pruneSpottyPrices, syncWeather } from '$lib/sync.js';
import cron from 'node-cron';

// ── Cron scheduler (starts once at module load) ───────────────────────────────
let cronJob = null;
let cronExpr = null;

function scheduleCron() {
  const minutes = parseInt(
    db.prepare("SELECT value FROM app_settings WHERE key = 'sync_interval'").get()?.value ?? '1'
  );
  const expr = `*/${Math.max(1, minutes)} * * * *`;
  if (expr === cronExpr) return;
  cronJob?.stop();
  cronJob = cron.schedule(expr, () => syncAll().catch(console.error));
  cronExpr = expr;
  console.log(`[cron] sync scheduled: ${expr}`);
}

scheduleCron();

// ── Daily snapshot at 23:55 + spotty price pruning ───────────────────────────
cron.schedule('55 23 * * *', () => {
  try { syncDaily(); } catch (e) { console.error('[daily] snapshot failed:', e.message); }
  try { pruneSpottyPrices(); } catch (e) { console.error('[spotty] prune failed:', e.message); }
});
console.log('[cron] daily snapshot + spotty prune scheduled: 55 23 * * *');

// ── Spotty price sync: every hour at :05 ─────────────────────────────────────
cron.schedule('5 * * * *', () => {
  syncSpottyPrices().catch(e => console.error('[spotty] sync error:', e.message));
});
// Fetch prices once on startup
syncSpottyPrices().catch(e => console.error('[spotty] initial fetch error:', e.message));
console.log('[cron] spotty price sync scheduled: 5 * * * *');

// ── Weather sync: every hour at :15 ──────────────────────────────────────────
cron.schedule('15 * * * *', () => {
  syncWeather().catch(e => console.error('[weather] sync error:', e.message));
});
// Fetch weather once on startup
syncWeather().catch(e => console.error('[weather] initial fetch error:', e.message));
console.log('[cron] weather sync scheduled: 15 * * * *');

// Prune sessions every 30 minutes
let pruneTimer = null;
function startPrune() {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => { try { pruneSessions(); } catch {} }, 30 * 60 * 1000);
}
startPrune();

// ── Handle hook ───────────────────────────────────────────────────────────────
export async function handle({ event, resolve }) {
  // Attach session to locals
  event.locals.user = getSession(event.cookies) ?? null;

  const start    = Date.now();
  const response = await resolve(event);
  const elapsed  = Date.now() - start;

  // Activity log (skip static assets + API)
  const p = event.url.pathname;
  if (!p.startsWith('/api/') && !p.includes('.')) {
    try {
      db.prepare(`INSERT INTO activity_log
        (username, page_path, method, elapsed_ms, status_code, session_id, ip_address)
        VALUES (?,?,?,?,?,?,?)`).run(
          event.locals.user?.username ?? null,
          p,
          event.request.method,
          elapsed,
          response.status,
          event.cookies.get('bkw_sid') ?? null,
          event.request.headers.get('x-forwarded-for') ?? 'local'
        );
    } catch { /* non-fatal */ }
  }

  return response;
}
