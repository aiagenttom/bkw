import { getSession, pruneSessions } from '$lib/session.js';
import db from '$lib/db.js';
import { syncAll, syncDaily, syncSpottyPrices, syncWeather, syncAnker, syncShelly, pruneOldData } from '$lib/sync.js';
import cron from 'node-cron';

// ── Suppress noisy bot-scan request logs ─────────────────────────────────────
// Bots constantly probe for .php/.asp/etc – filter those [4xx] lines from logs.
const BOT_PATH_RE = /\.(php\d*|asp|aspx|env|git|cgi|bak|sql|ini|cfg|jsp|cfm|py|rb|pl|sh|xml|json\.php)$/i;
const LOG_LINE_RE = /^\[\d{3}\] (GET|POST|HEAD|OPTIONS) \//;
const _origLog = console.log;
console.log = (...args) => {
  if (args.length === 1 && typeof args[0] === 'string') {
    const s = args[0];
    if (LOG_LINE_RE.test(s) && BOT_PATH_RE.test(s)) return; // skip bot-scan log lines
  }
  _origLog(...args);
};

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
  cronJob = cron.schedule(expr, () => {
    syncAll().catch(console.error);
    syncAnker().catch(e => console.error('[anker] sync error:', e.message));
    syncShelly().catch(e => console.error('[shelly] sync error:', e.message));
  });
  cronExpr = expr;
  console.log(`[cron] sync scheduled: ${expr}`);
}

scheduleCron();

// ── Daily snapshot + data pruning at 23:55 ───────────────────────────────────
cron.schedule('55 23 * * *', () => {
  try { syncDaily(); } catch (e) { console.error('[daily] snapshot failed:', e.message); }
  try { pruneOldData(); } catch (e) { console.error('[prune] failed:', e.message); }
});
console.log('[cron] daily snapshot + prune scheduled: 55 23 * * *');

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

// Fetch Anker + Shelly once on startup
syncAnker().catch(e => console.error('[anker] initial sync error:', e.message));
syncShelly().catch(e => console.error('[shelly] initial sync error:', e.message));

// Prune sessions every 30 minutes
let pruneTimer = null;
function startPrune() {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => { try { pruneSessions(); } catch {} }, 30 * 60 * 1000);
}
startPrune();

// ── Handle hook ───────────────────────────────────────────────────────────────
export async function handle({ event, resolve }) {
  // Fast-reject bot scans for non-existent file extensions
  if (BOT_PATH_RE.test(event.url.pathname)) {
    return new Response(null, { status: 404 });
  }

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
