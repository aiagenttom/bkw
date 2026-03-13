import { fail } from '@sveltejs/kit';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import db from '$lib/db.js';

const ANKER_CONFIG_PATH = join(homedir(), '.bkw-data', 'anker-service.json');

function readAnkerConfig() {
  try {
    if (existsSync(ANKER_CONFIG_PATH))
      return JSON.parse(readFileSync(ANKER_CONFIG_PATH, 'utf8'));
  } catch {}
  return { enabled: false, email: '', device_sn: '', country: 'de' };
}

function writeAnkerConfig(cfg) {
  writeFileSync(ANKER_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

export async function load() {
  const inverters    = db.prepare('SELECT id, name, color FROM inverters WHERE enabled = 1 ORDER BY name').all();
  const pbRows       = db.prepare('SELECT * FROM powerbanks').all();
  const pbByInverter = Object.fromEntries(pbRows.map(r => [r.inverter_id, r]));
  const ankerConfig  = readAnkerConfig();

  // Letzten Messwert aus DB holen (zeigt ob die API jemals funktioniert hat)
  const lastReading = db.prepare(
    "SELECT strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS ts FROM anker_readings ORDER BY created_at DESC LIMIT 1"
  ).get()?.ts ?? null;

  const configReady = Boolean(ankerConfig.enabled && ankerConfig.email && ankerConfig.password);

  return { inverters, pbByInverter, ankerConfig, configReady, lastReading };
}

export const actions = {

  // ── Powerbank-Simulation (pro Inverter) ──────────────────────────────────
  save: async ({ request }) => {
    const d              = await request.formData();
    const inverterId     = parseInt(d.get('inverter_id'));
    const capacityKwh    = parseFloat(d.get('capacity_kwh'));
    const dischargeW     = parseFloat(d.get('discharge_w'));
    const enabled        = d.get('enabled') === '1' ? 1 : 0;
    const dischargeStart = (d.get('discharge_start') || '00:00').trim();
    const dischargeEnd   = (d.get('discharge_end')   || '23:59').trim();

    if (!inverterId || isNaN(capacityKwh) || isNaN(dischargeW))
      return fail(400, { error: 'Ungültige Eingabe' });
    if (capacityKwh <= 0 || dischargeW <= 0)
      return fail(400, { error: 'Kapazität und Abgabeleistung müssen > 0 sein' });

    db.prepare(`
      INSERT INTO powerbanks (inverter_id, capacity_wh, discharge_w, enabled, discharge_start, discharge_end)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(inverter_id) DO UPDATE SET
        capacity_wh     = excluded.capacity_wh,
        discharge_w     = excluded.discharge_w,
        enabled         = excluded.enabled,
        discharge_start = excluded.discharge_start,
        discharge_end   = excluded.discharge_end
    `).run(inverterId, Math.round(capacityKwh * 1000), dischargeW, enabled, dischargeStart, dischargeEnd);

    return { success: 'Gespeichert' };
  },

  delete: async ({ request }) => {
    const d          = await request.formData();
    const inverterId = parseInt(d.get('inverter_id'));
    if (!inverterId) return fail(400, { error: 'Fehlende ID' });
    db.prepare('DELETE FROM powerbanks WHERE inverter_id = ?').run(inverterId);
    return { success: 'Powerbank entfernt' };
  },

  // ── Anker SOLIX Einstellungen ────────────────────────────────────────────
  saveAnker: async ({ request }) => {
    const d        = await request.formData();
    const enabled  = d.get('anker_enabled') === '1';
    const email    = (d.get('anker_email')    || '').trim();
    const password = (d.get('anker_password') || '').trim();
    const deviceSn = (d.get('anker_device_sn') || '').trim();
    const country  = (d.get('anker_country')  || 'de').trim();

    const existing = readAnkerConfig();
    writeAnkerConfig({
      ...existing,
      enabled,
      email,
      password:  password || existing.password, // leer = altes PW behalten
      device_sn: deviceSn,
      country,
    });

    return { success: 'Anker-Einstellungen gespeichert.' };
  },
};
