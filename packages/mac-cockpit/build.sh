#!/bin/zsh
# Baut "Yep Cockpit.app" und legt sie nach /Applications (oder ~/Applications,
# falls /Applications nicht beschreibbar ist).
#
#   packages/mac-cockpit/build.sh            bauen und installieren
#   packages/mac-cockpit/build.sh --nur-bauen  nur nach build/ bauen
#
# Rechneradressen kommen aus "AI Worker/hosts/rollen.json" (Rollen
# arbeitsplatz und dienste), das Symbol aus hosts/cockpit-icons/mac.
set -euo pipefail

HIER=${0:A:h}
AIW="$HOME/Projects/AI Worker"
ROLLEN="$AIW/hosts/rollen.json"
SYMBOL="$AIW/hosts/cockpit-icons/mac/mac-app-1024.png"
AUSGABE="$HIER/build"
APP="$AUSGABE/Yep Cockpit.app"

[[ -f $ROLLEN ]] || { echo "Fehlt: $ROLLEN" >&2; exit 1; }
[[ -f $SYMBOL ]] || { echo "Fehlt: $SYMBOL (randlos.py ausfuehren)" >&2; exit 1; }

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -swift-version 5 -target arm64-apple-macos13.3 \
  -o "$APP/Contents/MacOS/YepCockpit" "$HIER/Sources/main.swift" "$HIER/Sources/Meldungen.swift"

sed "s/__VERSION__/$(date +%Y%m%d%H%M)/" "$HIER/Info.plist" > "$APP/Contents/Info.plist"

python3 - "$ROLLEN" "$APP/Contents/Resources/rechner.json" <<'PY'
import json, sys
rollen = json.load(open(sys.argv[1]))["rollen"]
rechner = [
    {"name": "Mac", "url": f"https://{rollen['arbeitsplatz']['tailnet']}:3400"},
    {"name": "aihub", "url": f"https://{rollen['dienste']['tailnet']}:3400"},
]
json.dump(rechner, open(sys.argv[2], "w"), indent=2)
PY

SATZ=$(mktemp -d)/AppIcon.iconset
mkdir -p "$SATZ"
for g in 16 32 128 256 512; do
  sips -z $g $g "$SYMBOL" --out "$SATZ/icon_${g}x${g}.png" >/dev/null
  sips -z $((g * 2)) $((g * 2)) "$SYMBOL" --out "$SATZ/icon_${g}x${g}@2x.png" >/dev/null
done
iconutil -c icns "$SATZ" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "${SATZ:h}"

# Ad-hoc-Signatur: reicht fuer den eigenen Mac, Mitteilungen brauchen ein
# signiertes Bundle mit fester Kennung.
codesign --force --sign - --timestamp=none "$APP"
echo "Gebaut: $APP"

[[ ${1:-} == --nur-bauen ]] && exit 0

ZIEL=/Applications
[[ -w $ZIEL ]] || ZIEL="$HOME/Applications"
mkdir -p "$ZIEL"
osascript -e 'tell application id "de.smartzone.yep-cockpit" to quit' >/dev/null 2>&1 || true
rm -rf "$ZIEL/Yep Cockpit.app"
ditto "$APP" "$ZIEL/Yep Cockpit.app"
echo "Installiert: $ZIEL/Yep Cockpit.app"
