#!/usr/bin/env bash
# Startet den Anker Solix Microservice mit Python 3.12
# Voraussetzung: brew install python@3.12
#                pip3.12 install -r requirements.txt

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Suche nach python3.12
if command -v python3.12 &>/dev/null; then
    PY=python3.12
elif command -v /opt/homebrew/bin/python3.12 &>/dev/null; then
    PY=/opt/homebrew/bin/python3.12
elif command -v /usr/local/bin/python3.12 &>/dev/null; then
    PY=/usr/local/bin/python3.12
else
    echo "ERROR: python3.12 nicht gefunden."
    echo "Bitte installieren:  brew install python@3.12"
    echo "Dann:                pip3.12 install -r requirements.txt"
    exit 1
fi

echo "Verwende: $($PY --version)"
cd "$SCRIPT_DIR"
exec "$PY" main.py "$@"
