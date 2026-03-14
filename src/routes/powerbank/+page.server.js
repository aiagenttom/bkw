import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import db from '$lib/db.js';

const CONFIG_PATH = join(homedir(), '.bkw-data', 'anker-service.json');

export async function load() {
  // Konfiguration prüfen
  let ankerEnabled = false;
  try {
    if (existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      ankerEnabled = Boolean(cfg?.enabled && cfg.email && cfg.password);
    }
  } catch {}

  // Letzter Messwert
  const latest = db.prepare(`
    SELECT soc, charge_w, discharge_w, state,
           strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS ts
    FROM anker_readings
    ORDER BY created_at DESC LIMIT 1
  `).get() ?? null;

  // 24h-Verlauf
  const history = db.prepare(`
    SELECT strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS ts,
           soc, charge_w, discharge_w, state
    FROM anker_readings
    WHERE created_at >= datetime('now', '-24 hours')
    ORDER BY created_at ASC
  `).all();

  // Lifetime-Statistiken aus app_settings
  function getSetting(key) {
    return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
  }
  const lifetimeKwh = getSetting('anker_lifetime_kwh');
  const lifetimeCo2 = getSetting('anker_lifetime_co2');
  const lifetimeEur = getSetting('anker_lifetime_eur');
  const retainLoadW = getSetting('anker_retain_load_w');

  const ankerLifetime = (lifetimeKwh != null || lifetimeCo2 != null || lifetimeEur != null)
    ? {
        kwh:           lifetimeKwh != null ? parseFloat(lifetimeKwh) : null,
        co2:           lifetimeCo2 != null ? parseFloat(lifetimeCo2) : null,
        eur:           lifetimeEur != null ? parseFloat(lifetimeEur) : null,
        retain_load_w: retainLoadW != null ? parseFloat(retainLoadW) : null,
      }
    : null;

  return { latest, history, ankerEnabled, ankerLifetime };
}
