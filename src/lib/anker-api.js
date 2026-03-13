/**
 * Anker SOLIX Cloud API – Node.js Client
 *
 * Basiert auf der Open-Source-Bibliothek anker-solix-api (MIT-Lizenz):
 * https://github.com/thomluther/anker-solix-api
 *
 * Authentifizierung:
 *   1. ECDH-Schlüsselaustausch mit dem Anker-Server (P-256 / prime256v1)
 *   2. Passwort-Verschlüsselung via AES-256-CBC (Key + IV = ECDH Shared Secret)
 *   3. POST /passport/login  → auth_token + user_id
 *   4. gtoken = MD5(user_id)  für alle weiteren Anfragen
 */

import crypto from 'node:crypto';

// ── Anker-Server ECDH-Public-Key (aus api/session.py der Library) ────────────
// Uncompressed P-256 point: 04 + 32-byte-X + 32-byte-Y
const SERVER_PUBLIC_KEY_HEX =
  '04c5c00c4f8d1197cc7c3167c52bf7acb054d722f0ef08dcd7e0883236e0d72a3868d9750cb47fa4619248f3d83f0f662671dadc6e2d31c2f41db0161651c7c076';

// ── Server-URLs nach Region (aus api/apitypes.py) ─────────────────────────────
const BASE_URLS = {
  eu:  'https://ankerpower-api-eu.anker.com',
  com: 'https://ankerpower-api.anker.com',
};

// Länder, die den EU-Server nutzen (aus API_COUNTRIES in apitypes.py)
const EU_COUNTRIES = new Set([
  'DE','AT','BE','BG','CH','CY','CZ','DK','EE','ES','FI','FR',
  'GB','GR','HR','HU','IE','IL','IS','IT','LI','LT','LU','LV',
  'ME','MT','NL','NO','PL','PT','RO','RS','SE','SI','SK','TR','UK',
  'AL','AM','AZ','BA','BY','GE','MD','MK','UA','XK',
]);

function getBaseUrl(country) {
  return EU_COUNTRIES.has((country || 'DE').toUpperCase())
    ? BASE_URLS.eu : BASE_URLS.com;
}

// ── Standard-Request-Header (aus api/apitypes.py + session.py) ───────────────
const BASE_HEADERS = {
  'content-type': 'application/json',
  'model-type':   'DESKTOP',
  'app-name':     'anker_power',
  'os-type':      'android',
};

// ── Krypto-Hilfsfunktionen ────────────────────────────────────────────────────

function md5(str) {
  return crypto.createHash('md5').update(String(str)).digest('hex');
}

/** Erzeugt ein P-256-Schlüsselpaar und liefert ecdh + publicKeyHex (unkomprimiert: 04+X+Y) */
function generateClientKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { ecdh, publicKeyHex: ecdh.getPublicKey('hex') };
}

/** ECDH-Shared-Secret mit dem Anker-Server-Key (nur X-Koordinate, 32 Bytes) */
function computeSharedKey(ecdh) {
  const serverPub = Buffer.from(SERVER_PUBLIC_KEY_HEX, 'hex');
  return ecdh.computeSecret(serverPub); // 32 Bytes für P-256
}

/** AES-256-CBC-Verschlüsselung des Passworts: Key=sharedKey, IV=sharedKey[:16] */
function encryptPassword(password, sharedKey) {
  const key    = sharedKey.slice(0, 32);
  const iv     = sharedKey.slice(0, 16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc    = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return enc.toString('base64');
}

// ── AnkerApi-Klasse ───────────────────────────────────────────────────────────

export class AnkerApi {
  constructor(email, password, country = 'de') {
    this.email    = email;
    this.password = password;
    this.country  = (country || 'de').toUpperCase();
    this.baseUrl  = getBaseUrl(this.country);
    this._token   = null;
    this._gtoken  = null;
    this._tokenExp = 0;
  }

  isTokenValid() {
    return Boolean(this._token) && Date.now() < this._tokenExp - 60_000;
  }

  /** Login mit ECDH + AES-256-CBC-verschlüsseltem Passwort */
  async login() {
    const { ecdh, publicKeyHex } = generateClientKeys();
    const sharedKey = computeSharedKey(ecdh);
    const encPw     = encryptPassword(this.password, sharedKey);

    const body = {
      ab:                  this.country,
      client_secret_info:  { public_key: publicKeyHex },
      enc:                 0,
      email:               this.email,
      password:            encPw,
      time_zone:           -new Date().getTimezoneOffset() * 60 * 1000, // ms-Offset (z.B. 3600000 für GMT+1)
      transaction:         String(Date.now()),
    };

    const resp = await fetch(`${this.baseUrl}/passport/login`, {
      method:  'POST',
      headers: BASE_HEADERS,
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(12_000),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Anker Login HTTP ${resp.status}: ${txt.slice(0, 200)}`);
    }

    const j = await resp.json();
    if (j.code !== 0) throw new Error(`Anker Login abgelehnt (code ${j.code}): ${j.msg ?? ''}`);

    const d = j.data;
    this._token    = d.auth_token;
    this._gtoken   = md5(d.user_id);
    this._tokenExp = (d.token_expires_at ?? 0) * 1000;
    return d;
  }

  async ensureLogin() {
    if (!this.isTokenValid()) await this.login();
  }

  _authHeaders() {
    return {
      ...BASE_HEADERS,
      country:          this.country,
      'x-auth-token':   this._token,
      gtoken:           this._gtoken,
    };
  }

  async _post(path, body = {}) {
    await this.ensureLogin();
    const resp = await fetch(`${this.baseUrl}/${path}`, {
      method:  'POST',
      headers: this._authHeaders(),
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(12_000),
    });
    if (!resp.ok) throw new Error(`Anker POST ${path}: HTTP ${resp.status}`);
    const j = await resp.json();
    if (j.code !== 0) throw new Error(`Anker POST ${path}: code ${j.code} ${j.msg ?? ''}`);
    return j.data;
  }

  // ── Gerätestatus abrufen ───────────────────────────────────────────────────

  async getDeviceStatus(deviceSn = null) {
    // 1. Site-Liste abrufen (API erwartet POST)
    const siteData = await this._post('power_service/v1/site/get_site_list');
    const sites    = siteData?.site_list ?? [];
    if (sites.length === 0) throw new Error('Anker: keine Sites gefunden');

    // 2. Scene-Info der ersten Site abrufen
    // Achtung: offizielle API hat Tippfehler "get_scen_info" (fehlendes 'e')
    const scene = await this._post('power_service/v1/site/get_scen_info', {
      site_id: sites[0].site_id,
    });

    return parseDeviceStatus(scene, deviceSn);
  }

  /** Gibt die rohen scene_info-Daten zurück – nützlich zur Fehlersuche */
  async dumpSceneInfo() {
    const siteData = await this._post('power_service/v1/site/get_site_list');
    const sites    = siteData?.site_list ?? [];
    if (sites.length === 0) return { sites: [] };
    const scene = await this._post('power_service/v1/site/get_scen_info', {
      site_id: sites[0].site_id,
    });
    return { sites, scene };
  }
}

// ── scene_info parsen → { soc, charge_w, discharge_w, state, device_sn } ─────

function num(v, fallback = null) {
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}

function chargingState(cs) {
  const s = String(cs ?? '');
  if (s === '1') return 'charging';
  if (s === '2') return 'discharging';
  if (s === '3') return 'bypass';
  return 'standby';
}

function parseDeviceStatus(scene, deviceSn = null) {
  // ── Solarbank (SOLIX Solarbank 1 / 2) ────────────────────────────────────
  const solarbanks = scene?.solarbank_info?.solarbank_list ?? [];
  for (const sb of solarbanks) {
    if (deviceSn && sb.device_sn !== deviceSn) continue;
    // Gesamt-PV-Eingang: Summe aller Panel-Strings (solar_power_1..4)
    // Fallback: charging_power + output_power (was ins Netz geht + was in die Batterie geht)
    const pvStrings = [sb.solar_power_1, sb.solar_power_2, sb.solar_power_3, sb.solar_power_4]
      .map(v => num(v, 0)).reduce((a, b) => a + b, 0);
    const charge_w    = num(sb.charging_power ?? sb.pv_to_battery_power ?? sb.charge_power_limit);
    const discharge_w = num(sb.output_power   ?? sb.battery_to_output_power ?? sb.discharge_power);
    const solar_power = pvStrings > 0
      ? pvStrings
      : num(sb.solar_power ?? sb.total_solar_power ?? sb.pv_power, null);
    return {
      device_sn:   sb.device_sn ?? null,
      soc:         num(sb.battery_power ?? sb.battery_soc),
      charge_w,
      discharge_w,
      solar_power, // Gesamt-PV-Leistung der ans Anker-Gerät angeschlossenen Panels (W)
      state:       chargingState(sb.charging_status),
    };
  }

  // ── PPS / Power Station (SOLIX F1500, C800, …) ───────────────────────────
  const ppsList = scene?.pps_info?.pps_list ?? [];
  for (const pps of ppsList) {
    if (deviceSn && pps.device_sn !== deviceSn) continue;
    return {
      device_sn:   pps.device_sn ?? null,
      soc:         num(pps.battery_power ?? pps.soc),
      charge_w:    num(pps.input_power   ?? pps.charge_power),
      discharge_w: num(pps.output_power  ?? pps.discharge_power),
      solar_power: num(pps.solar_power   ?? pps.pv_power, null),
      state:       chargingState(pps.charging_status),
    };
  }

  // ── Fallback: generische Geräteliste ─────────────────────────────────────
  const devices = scene?.home_info?.home_device_list ?? scene?.device_list ?? [];
  for (const dev of devices) {
    if (deviceSn && dev.device_sn !== deviceSn) continue;
    return {
      device_sn:   dev.device_sn ?? null,
      soc:         num(dev.battery_power ?? dev.soc),
      charge_w:    num(dev.charging_power ?? dev.input_power),
      discharge_w: num(dev.output_power),
      solar_power: num(dev.solar_power ?? dev.pv_power, null),
      state:       chargingState(dev.charging_status),
    };
  }

  throw new Error(
    'Anker: kein Gerät in scene_info gefunden. ' +
    'Prüfe die Seriennummer oder aktiviere den Debug-Dump unter /api/anker-status?dump=1'
  );
}

// ── Singleton (Token bleibt zwischen Anfragen im selben Node-Prozess) ─────────
let _instance = null;

export function getAnkerApi(email, password, country) {
  const cc = (country || 'de').toUpperCase();
  if (!_instance || _instance.email !== email || _instance.country !== cc) {
    _instance = new AnkerApi(email, password, country);
  } else if (_instance.password !== password) {
    _instance.password  = password;
    _instance._token    = null;  // zwingt erneutes Login
    _instance._tokenExp = 0;
  }
  return _instance;
}
