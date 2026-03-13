import { json } from '@sveltejs/kit';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import db from '$lib/db.js';
import { getAnkerApi } from '$lib/anker-api.js';

const CONFIG_PATH = join(homedir(), '.bkw-data', 'anker-service.json');

function readConfig() {
  try {
    if (existsSync(CONFIG_PATH)) return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {}
  return null;
}

export async function GET({ url }) {
  const config = readConfig();
  let live         = null;
  let serviceOnline = false;
  let errorMsg      = null;

  if (config?.enabled && config.email && config.password) {
    try {
      const api    = getAnkerApi(config.email, config.password, config.country || 'de');
      const status = await api.getDeviceStatus(config.device_sn || null);
      live          = status;
      serviceOnline = true;

      // Messwert in DB speichern
      db.prepare(`
        INSERT INTO anker_readings (device_sn, soc, charge_w, discharge_w, state)
        VALUES (?, ?, ?, ?, ?)
      `).run(status.device_sn, status.soc, status.charge_w, status.discharge_w, status.state);

    } catch (e) {
      errorMsg = e.message;
      console.error('[anker-status]', e.message);
    }
  } else {
    errorMsg = config?.enabled
      ? 'E-Mail oder Passwort nicht konfiguriert'
      : 'Anker-Integration nicht aktiviert';
  }

  // Debug-Dump (nur für Admins zur Fehlersuche: /api/anker-status?dump=1)
  if (url.searchParams.get('dump') === '1' && config?.email && config?.password) {
    try {
      const api  = getAnkerApi(config.email, config.password, config.country || 'de');
      const dump = await api.dumpSceneInfo();
      return json({ success: true, dump });
    } catch (e) {
      return json({ success: false, error: e.message });
    }
  }

  // 24h-Verlauf aus DB
  const history = db.prepare(`
    SELECT strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS ts,
           soc, charge_w, discharge_w, state
    FROM anker_readings
    WHERE created_at >= datetime('now', '-24 hours')
    ORDER BY created_at ASC
  `).all();

  // Letzter Messwert aus DB (Fallback wenn gerade kein Abruf möglich)
  const latest = db.prepare(`
    SELECT soc, charge_w, discharge_w, state,
           strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS ts
    FROM anker_readings
    ORDER BY created_at DESC LIMIT 1
  `).get() ?? null;

  return json({ success: true, serviceOnline, live, latest, history, error: errorMsg });
}
