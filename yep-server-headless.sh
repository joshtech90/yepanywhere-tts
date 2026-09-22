#!/bin/zsh
#
# Headless-Start fuer Yep Anywhere (ohne Browser, ohne Terminal-Fenster).
# Wird vom launchd-Agent com.joscha.yepanywhere beim Login aufgerufen.
# Spiegelt die Server-Konfiguration aus "Start Yep (mit Vorlesen).command",
# laesst aber den Browser-Open + die interaktiven Echos weg.
#
set -e
cd "$(dirname "$0")"

PORT="${PORT:-3400}"
DATA_DIR="$HOME/.yep-anywhere"
JSON_QUELLE="/Users/joscha/Documents/Google Cloud API/Google Cloud JSON joschasgemini modular-glider-469107-a0-98936530d5fb.json"
TLS_CERT="$DATA_DIR/tls/cert.crt"
TLS_KEY="$DATA_DIR/tls/cert.key"

# launchd uebernimmt nicht den interaktiven Shell-PATH. Beide Orte enthalten
# auf diesem Mac global installierte CLIs (unter anderem Codex/codex-auth).
export PATH="/opt/homebrew/bin:$HOME/.npm-global/bin:$PATH"

# Node fuer den Server festlegen (aendert das normale Node nicht).
# YA verlangt seit upstream ^22.16 || ^23.11 || >=24.10; node@20 startet nicht
# mehr. node@24 ist die konservativste erlaubte Version auf diesem Mac.
for NODE_KELLER in /opt/homebrew/opt/node@24/bin /opt/homebrew/opt/node@26/bin; do
  if [ -x "$NODE_KELLER/node" ]; then
    export PATH="$NODE_KELLER:$PATH"
    break
  fi
done
NODE_BIN="$(command -v node)"

# Google-Stimmen-Datei sicherstellen (fuer Algenib-Vorlesen)
if [ ! -f "$DATA_DIR/tts-service-account.json" ] && [ -f "$JSON_QUELLE" ]; then
  mkdir -p "$DATA_DIR"
  cp "$JSON_QUELLE" "$DATA_DIR/tts-service-account.json"
  chmod 600 "$DATA_DIR/tts-service-account.json"
fi

# Falls noch nicht gebaut oder die Bibliotheken fehlen: installieren und bauen.
# Am 22.09.2026 fehlte node_modules bei vorhandenem dist, und der Server
# startete in Endlosschleife mit ERR_MODULE_NOT_FOUND. Die pnpm-Version folgt
# packageManager in package.json; pnpm 9 wirft die Overrides aus dem Lockfile.
if [ ! -f packages/server/dist/index.js ] || [ ! -d node_modules/.pnpm ]; then
  npx --yes pnpm@10.34.5 install --frozen-lockfile
  npx --yes pnpm@10.34.5 build
fi

# Evtl. alte Instanz auf dem Port beenden (idempotent bei Re-Launch)
ALT_PIDS="$(lsof -ti tcp:$PORT 2>/dev/null || true)"
if [ -n "$ALT_PIDS" ]; then
  echo "$ALT_PIDS" | xargs kill 2>/dev/null || true
  sleep 2
fi

# Server im Vordergrund dieses Prozesses starten (launchd haelt ihn am Leben).
# CodexLB verteilt neue Codex-Aufrufe automatisch auf alle vier Konten.
# Sessions, Config und Skills bleiben ueber die gemeinsamen Symlinks unter
# ~/.codex erhalten. YA nutzt ohne CODEX_SESSIONS_DIR-Override automatisch
# CODEX_HOME/sessions.
export CODEX_HOME="$HOME/.codex-profiles/loadbalanced"
exec env ENABLED_PROVIDERS=claude,codex PORT="$PORT" NODE_ENV=production HOST=0.0.0.0 \
  CLI_HOST_OVERRIDE=true \
  TLS_CERT_PATH="$TLS_CERT" TLS_KEY_PATH="$TLS_KEY" \
  "$NODE_BIN" packages/server/dist/index.js
