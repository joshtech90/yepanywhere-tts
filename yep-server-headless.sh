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

# Node 20 (aendert das normale Node nicht)
if [ -d /opt/homebrew/opt/node@20/bin ]; then
  export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
fi
NODE_BIN="$(command -v node)"

# Google-Stimmen-Datei sicherstellen (fuer Algenib-Vorlesen)
if [ ! -f "$DATA_DIR/tts-service-account.json" ] && [ -f "$JSON_QUELLE" ]; then
  mkdir -p "$DATA_DIR"
  cp "$JSON_QUELLE" "$DATA_DIR/tts-service-account.json"
  chmod 600 "$DATA_DIR/tts-service-account.json"
fi

# Falls noch nicht gebaut: einmal bauen (sollte normal schon da sein)
if [ ! -f packages/server/dist/index.js ]; then
  npx --yes pnpm@9.15.1 install
  npx --yes pnpm@9.15.1 build
fi

# Evtl. alte Instanz auf dem Port beenden (idempotent bei Re-Launch)
ALT_PIDS="$(lsof -ti tcp:$PORT 2>/dev/null || true)"
if [ -n "$ALT_PIDS" ]; then
  echo "$ALT_PIDS" | xargs kill 2>/dev/null || true
  sleep 2
fi

# Server im Vordergrund dieses Prozesses starten (launchd haelt ihn am Leben).
# Claude- und Codex-Sessions gemeinsam anzeigen. Ohne CODEX_SESSIONS_DIR-
# Override nutzt YA automatisch CODEX_HOME/sessions (normal: ~/.codex/sessions),
# was auch bei Account-Wechseln via codex-auth stabil bleibt.
exec env ENABLED_PROVIDERS=claude,codex PORT="$PORT" NODE_ENV=production HOST=0.0.0.0 \
  CLI_HOST_OVERRIDE=true \
  TLS_CERT_PATH="$TLS_CERT" TLS_KEY_PATH="$TLS_KEY" \
  "$NODE_BIN" packages/server/dist/index.js
