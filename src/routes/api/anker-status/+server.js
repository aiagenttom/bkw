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

      // Messwert in DB speichern (inkl. solar_power falls vorhanden)
      db.prepare(`
        INSERT INTO anker_readings (device_sn, soc, charge_w, discharge_w, solar_power, state)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(status.device_sn, status.soc, status.charge_w, status.discharge_w,
             status.solar_power ?? null, status.state);

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
           soc, charge_w, discharge_w, solar_power, state
    FROM anker_readings
    WHERE created_at >= datetime('now', '-24 hours')
    ORDER BY created_at ASC
  `).all();

  // Letzter Messwert aus DB (Fallback wenn gerade kein Abruf möglich)
  const latest = db.prepare(`
    SELECT soc, charge_w, discharge_w, solar_power, state,
           strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS ts
    FROM anker_readings
    ORDER BY created_at DESC LIMIT 1
  `).get() ?? null;

  // Heutiger Anker-Korrektur-Ertrag:
  // = Energie die in die Batterie geflossen ist (charge_w), NICHT durch Hoymiles gemessen.
  // Im Bypass-Modus ist charge_w ≈ 0 → Hoymiles sieht alles → korrekt keine Addition.
  // Formel: SUM(charge_w_W) × sync_interval_min / 60 = Wh
  const syncMin = parseInt(
    db.prepare("SELECT value FROM app_settings WHERE key = 'sync_interval'").get()?.value ?? '1'
  );
  const tzH = parseInt(
    db.prepare("SELECT value FROM app_settings WHERE key = 'tz_offset_h'").get()?.value ?? '1'
  );
  const ankerYieldToday = db.prepare(`
    SELECT
      ROUND(SUM(charge_w) * ? / 60.0, 1) AS charge_wh,
      ROUND(SUM(COALESCE(solar_power, 0)) * ? / 60.0, 1) AS solar_wh
    FROM anker_readings
    WHERE date(datetime(created_at, '+' || ? || ' hours')) = date(datetime('now', '+' || ? || ' hours'))
      AND charge_w IS NOT NULL AND charge_w > 0
  `).get(syncMin, syncMin, tzH, tzH) ?? { charge_wh: null, solar_wh: null };

  return json({
    success: true, serviceOnline, live, latest, history, error: errorMsg,
    // charge_wh: Energie die heute in Batterie geflossen ist (von OpenDTU NICHT gemessen)
    // solar_wh:  Gesamt-PV-Ertrag der ans Anker-Gerät angeschlossenen Panels heute
    ankerChargeToday: ankerYieldToday.charge_wh,  // Korrektur für OpenDTU-Gesamtertrag
    ankerSolarToday:  ankerYieldToday.solar_wh,   // Nur wenn solar_power befüllt
  });
}
