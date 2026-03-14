/**
 * Anker SOLIX Status-Endpoint
 *
 * Liefert den aktuellen Status + 24h-Verlauf NUR aus der lokalen Datenbank.
 * Das Polling der Anker Cloud-API läuft ausschließlich im Hintergrund-Cron (hooks.server.js).
 * → Kein Browser-Request löst mehr einen Cloud-Call aus.
 *
 * serviceOnline = true wenn der letzte Messwert < 15 Minuten alt ist.
 */
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

  // ── Debug-Dump (direkter API-Call, nur für Admins) ──────────────────────────
  if (url.searchParams.get('dump') === '1' && config?.email && config?.password) {
    try {
      const api  = getAnkerApi(config.email, config.password, config.country || 'de');
      const dump = await api.dumpSceneInfo();
      return json({ success: true, dump });
    } catch (e) {
      return json({ success: false, error: e.message });
    }
  }

  // ── Letzter Messwert aus DB ─────────────────────────────────────────────────
  const latest = db.prepare(`
    SELECT soc, charge_w, discharge_w, solar_power, state,
           strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS ts
    FROM anker_readings
    ORDER BY created_at DESC LIMIT 1
  `).get() ?? null;

  // serviceOnline = letzter Messwert ist < 15 Minuten alt
  const serviceOnline = latest
    ? (Date.now() - new Date(latest.ts).getTime()) < 15 * 60 * 1000
    : false;

  // ── 24h-Verlauf aus DB ──────────────────────────────────────────────────────
  const history = db.prepare(`
    SELECT strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS ts,
           soc, charge_w, discharge_w, solar_power, state
    FROM anker_readings
    WHERE created_at >= datetime('now', '-24 hours')
    ORDER BY created_at ASC
  `).all();

  // ── Heutiger Anker-Korrektur-Ertrag ────────────────────────────────────────
  // = Energie die in die Batterie geflossen ist (charge_w), NICHT durch Hoymiles gemessen.
  // Im Bypass-Modus ist charge_w ≈ 0 → Hoymiles sieht alles → korrekt keine Addition.
  // Formel: SUM(charge_w) × sync_interval_min / 60 = Wh
  const syncMin = parseInt(db.prepare("SELECT value FROM app_settings WHERE key = 'sync_interval'").get()?.value ?? '1');
  const tzH = parseInt(
    db.prepare("SELECT value FROM app_settings WHERE key = 'tz_offset_h'").get()?.value ?? '1'
  );
  const ankerYieldToday = db.prepare(`
    SELECT
      ROUND(SUM(charge_w)                   * ? / 60.0, 1) AS charge_wh,
      ROUND(SUM(COALESCE(solar_power, 0))   * ? / 60.0, 1) AS solar_wh
    FROM anker_readings
    WHERE date(datetime(created_at, '+' || ? || ' hours')) = date(datetime('now', '+' || ? || ' hours'))
      AND charge_w IS NOT NULL AND charge_w > 0
  `).get(syncMin, syncMin, tzH, tzH) ?? { charge_wh: null, solar_wh: null };

  // ── Lifetime-Statistiken aus app_settings ──────────────────────────────────
  function getSetting(key) {
    return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
  }
  const lifetimeKwh = getSetting('anker_lifetime_kwh');
  const lifetimeCo2 = getSetting('anker_lifetime_co2');
  const lifetimeEur = getSetting('anker_lifetime_eur');
  const retainLoadW = getSetting('anker_retain_load_w');

  const ankerLifetime = (lifetimeKwh != null || lifetimeCo2 != null || lifetimeEur != null)
    ? {
        kwh:          lifetimeKwh != null ? parseFloat(lifetimeKwh) : null,
        co2:          lifetimeCo2 != null ? parseFloat(lifetimeCo2) : null,
        eur:          lifetimeEur != null ? parseFloat(lifetimeEur) : null,
        retain_load_w: retainLoadW != null ? parseFloat(retainLoadW) : null,
      }
    : null;

  const errorMsg = serviceOnline
    ? null
    : (config?.enabled
        ? 'Kein aktueller Messwert – Hintergrunddienst läuft alle 5 min'
        : 'Anker-Integration nicht aktiviert');

  return json({
    success: true,
    serviceOnline,
    live:    latest,   // Kompatibilität mit altem Feld-Namen
    latest,
    history,
    error:   errorMsg,
    // charge_wh: Energie die heute in Batterie geflossen ist (von OpenDTU NICHT gemessen)
    // solar_wh:  Gesamt-PV-Ertrag der ans Anker-Gerät angeschlossenen Panels heute
    ankerChargeToday: ankerYieldToday.charge_wh,
    ankerSolarToday:  ankerYieldToday.solar_wh,
    // Lifetime-Statistiken von der Anker-Cloud (null bis erste Sync-Runde)
    ankerLifetime,
  });
}
