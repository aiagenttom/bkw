#!/usr/bin/env python3
"""
Anker Solix Microservice für BKW Solar Dashboard
=================================================
Stellt SOC, Lade- und Entladeleistung der Anker SOLIX Powerbank
als einfachen HTTP-Dienst zur Verfügung.

Voraussetzungen:
  Python 3.12+  (brew install python@3.12)
  pip3.12 install flask aiohttp anker-solix-api

Start:
  ./start.sh
  oder manuell:
  ANKER_CONFIG=~/.bkw-data/anker-service.json python3.12 main.py
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path
from threading import Thread, Lock

# ── Config ────────────────────────────────────────────────────────────────────
CONFIG_PATH = Path(
    os.environ.get('ANKER_CONFIG',
                   str(Path.home() / '.bkw-data' / 'anker-service.json'))
)

DEFAULT_PORT = 7331

# ── Shared state (thread-safe) ────────────────────────────────────────────────
_lock   = Lock()
_status = {
    'ok':      False,
    'devices': [],
    'error':   'Noch kein Abruf erfolgt',
    'ts':      0,
}

# ── Config reader ─────────────────────────────────────────────────────────────
def load_config():
    try:
        with open(CONFIG_PATH, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except Exception as e:
        print(f'[anker] Config-Lesefehler: {e}', file=sys.stderr)
        return None


# ── Anker API fetch ───────────────────────────────────────────────────────────
async def fetch_from_anker(config: dict) -> dict:
    """
    Authentifiziert gegen die Anker Cloud und liest Gerätedaten aus.
    Gibt ein Dict mit 'ok', 'devices', optional 'error' zurück.
    """
    try:
        import aiohttp
        from api import AnkerSolixApi
    except ImportError as e:
        return {'ok': False, 'error': f'Import-Fehler: {e}. Bitte anker-solix-api installieren.', 'devices': []}

    email    = config.get('email', '').strip()
    password = config.get('password', '').strip()
    country  = config.get('country', 'de').strip()

    if not email or not password:
        return {'ok': False, 'error': 'E-Mail oder Passwort fehlt in der Konfiguration.', 'devices': []}

    try:
        async with aiohttp.ClientSession() as session:
            api = AnkerSolixApi(email, password, country, session)

            await api.update_sites()
            await api.update_device_details()

            target_sn = config.get('device_sn', '').strip()
            devices   = []

            for sn, raw in api.devices.items():
                if target_sn and sn != target_sn:
                    continue

                # Defensiv: verschiedene Feldnamen je nach Library-Version
                def pick(*keys, default=None):
                    for k in keys:
                        v = raw.get(k)
                        if v is not None:
                            return v
                    return default

                soc        = pick('battery_soc', 'soc', 'battery_level')
                charge_w   = pick('charging_power',    'charge_power_w',  'input_power',  'ac_input_power',  default=0)
                discharge_w = pick('discharging_power', 'discharge_power_w', 'output_power', 'ac_output_power', default=0)
                state      = pick('charging_status', 'charging_state', 'state', default='unknown')
                name       = pick('alias', 'device_name', 'name', default=sn)
                model      = pick('device_pn', 'pn', 'model', default='')

                # Zahlen-Normalisierung
                try:   soc        = float(soc)        if soc        is not None else None
                except: soc       = None
                try:   charge_w   = float(charge_w)   if charge_w   else 0.0
                except: charge_w  = 0.0
                try:   discharge_w = float(discharge_w) if discharge_w else 0.0
                except: discharge_w = 0.0

                devices.append({
                    'sn':          sn,
                    'name':        name,
                    'model':       model,
                    'soc':         soc,
                    'charge_w':    charge_w,
                    'discharge_w': discharge_w,
                    'state':       str(state),
                    # Rohwerte für Debugging
                    '_raw_keys':   list(raw.keys()),
                })

            return {'ok': True, 'devices': devices, 'ts': time.time()}

    except Exception as e:
        return {'ok': False, 'error': str(e), 'devices': [], 'ts': time.time()}


# ── Poll-Loop ─────────────────────────────────────────────────────────────────
def poll_loop():
    """Läuft im Hintergrund-Thread und aktualisiert _status periodisch."""
    global _status

    while True:
        config = load_config()

        if not config or not config.get('enabled', False):
            time.sleep(15)
            continue

        poll_sec = max(30, int(config.get('poll_interval_sec', 60)))

        result = asyncio.run(fetch_from_anker(config))
        result['ts'] = time.time()

        with _lock:
            _status = result

        if result['ok']:
            devs = result['devices']
            print(f"[anker] {len(devs)} Gerät(e) abgerufen | "
                  + " | ".join(
                      f"{d['name']}: SOC={d['soc']}% ↑{d['charge_w']}W ↓{d['discharge_w']}W"
                      for d in devs
                  ), flush=True)
        else:
            print(f"[anker] Fehler: {result.get('error', '?')}", file=sys.stderr, flush=True)

        time.sleep(poll_sec)


# ── Flask App ─────────────────────────────────────────────────────────────────
try:
    from flask import Flask, jsonify
except ImportError:
    print('ERROR: flask nicht installiert. Bitte: pip3.12 install flask', file=sys.stderr)
    sys.exit(1)

flask_app = Flask(__name__)


@flask_app.route('/health')
def health():
    with _lock:
        age = round(time.time() - _status['ts'], 1) if _status['ts'] else None
    return jsonify({'ok': True, 'last_fetch_sec_ago': age})


@flask_app.route('/status')
def status():
    with _lock:
        return jsonify(dict(_status))


@flask_app.route('/dump')
def dump():
    """Gibt alle Rohdaten zurück – hilfreich zum Debuggen von Feldnamen."""
    with _lock:
        return jsonify(dict(_status))


# ── Startup ───────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    if sys.version_info < (3, 12):
        print(f'ERROR: Python 3.12+ benötigt, gefunden: {sys.version}', file=sys.stderr)
        print('Bitte installieren:  brew install python@3.12', file=sys.stderr)
        sys.exit(1)

    config = load_config()
    port   = int((config or {}).get('port', DEFAULT_PORT))

    print(f'[anker] Starte Anker Solix Microservice auf Port {port}')
    print(f'[anker] Config: {CONFIG_PATH}')
    if not config:
        print('[anker] Keine Config-Datei gefunden – bitte im Admin-Bereich einrichten.', file=sys.stderr)
    elif not config.get('enabled'):
        print('[anker] Dienst in Config deaktiviert (enabled=false).', file=sys.stderr)

    t = Thread(target=poll_loop, daemon=True)
    t.start()

    flask_app.run(host='0.0.0.0', port=port, debug=False)
