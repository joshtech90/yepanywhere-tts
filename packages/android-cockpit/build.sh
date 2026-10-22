#!/bin/zsh
# Baut die Android-App "Yep Cockpit" und legt die APK auf den Schreibtisch.
#
#   packages/android-cockpit/build.sh            Release bauen, nach ~/Desktop
#   packages/android-cockpit/build.sh --debug    Debug bauen und auf das per
#                                                adb verbundene Geraet spielen
#
# Alles Private kommt von ausserhalb dieses oeffentlichen Repos:
# - Rechneradressen: "AI Worker/hosts/rollen.json" (Rollen arbeitsplatz, dienste)
# - Symbole und Farben: "AI Worker/hosts/cockpit-icons/<rechner>/zeichen.svg"
# - Firebase-Client: "Smartzone OS/cockpit-apps/yep-cockpit-google-services.json"
#   (Projekt smartzone-cockpit-push); fehlt sie, baut die App ohne Push
# - Signatur: Smartzone-Release-Schluessel aus "Smartzone OS/cockpit-apps/signing"
set -euo pipefail

HIER=${0:A:h}
AIW="$HOME/Projects/AI Worker"
SZ="$HOME/Projects/Smartzone OS/cockpit-apps"
ROLLEN="$AIW/hosts/rollen.json"
SYMBOLE="$AIW/hosts/cockpit-icons"
FIREBASE="$SZ/yep-cockpit-google-services.json"
SIGNATUR="$SZ/signing/signing.properties"
GENERIERT="$HIER/app/src/generiert/res"
PAKET=de.joscha.yepcockpit

export JAVA_HOME=${JAVA_HOME:-"/Applications/Android Studio.app/Contents/jbr/Contents/Home"}
export ANDROID_HOME=${ANDROID_HOME:-"$HOME/Library/Android/sdk"}

[[ -f $ROLLEN ]] || { echo "Fehlt: $ROLLEN" >&2; exit 1; }

# Rechnerliste, Push-Bruecke, Firebase-Werte und Symbole erzeugen.
EIGENSCHAFTEN=$(python3 - "$ROLLEN" "$SYMBOLE" "$FIREBASE" "$GENERIERT" "$PAKET" <<'PY'
import json, re, sys
from pathlib import Path

rollen_pfad, symbole, firebase, generiert, paket = sys.argv[1:]
rollen = json.load(open(rollen_pfad))["rollen"]
gen = Path(generiert)
for unter in ("drawable", "mipmap-anydpi-v26", "values"):
    (gen / unter).mkdir(parents=True, exist_ok=True)

def zeichen(name):
    svg = (Path(symbole) / name / "zeichen.svg").read_text()
    kachel = re.search(r'<rect[^>]*fill="(#[0-9A-Fa-f]{6})"', svg).group(1)
    striche = re.findall(r'<path d="([^"]+)"[^>]*stroke="(#[0-9A-Fa-f]{6})"[^>]*stroke-width="([\d.]+)"', svg)
    return kachel, striche

def pfad(d):
    # "M x y x y ..." -> "M x,y L x,y ..." (Android braucht kein implizites L, sicher ist sicher)
    zahlen = re.findall(r"-?[\d.]+", d)
    punkte = [f"{zahlen[i]},{zahlen[i + 1]}" for i in range(0, len(zahlen), 2)]
    return "M" + punkte[0] + "".join(" L" + p for p in punkte[1:])

def striche_xml(striche, farbe=None, breite_faktor=1.0):
    return "\n".join(
        f'        <path android:pathData="{pfad(d)}" android:strokeColor="{farbe or f}" '
        f'android:strokeWidth="{float(w) * breite_faktor:.2f}" android:strokeLineCap="round" '
        f'android:strokeLineJoin="round" android:fillColor="#00000000"/>'
        for d, f, w in striche
    )

NS = 'xmlns:android="http://schemas.android.com/apk/res/android"'
rechner, farben = [], {}
for schluessel, name, rolle in (("mac", "Mac", "arbeitsplatz"), ("aihub", "aihub", "dienste")):
    kachel, striche = zeichen(schluessel)
    farben[schluessel] = kachel
    rechner.append({
        "schluessel": schluessel, "name": name,
        "url": f"https://{rollen[rolle]['tailnet']}:3400",
        "kachel": kachel, "akzent": striche[0][1],
    })
    # Volles Symbol (Kachel + Zeichen) fuer die Verknuepfungen am App-Symbol.
    (gen / "drawable" / f"zeichen_{schluessel}.xml").write_text(f'''<vector {NS}
    android:width="48dp" android:height="48dp" android:viewportWidth="64" android:viewportHeight="64">
    <path android:pathData="M17,2 L47,2 A15,15 0 0 1 62,17 L62,47 A15,15 0 0 1 47,62 L17,62 A15,15 0 0 1 2,47 L2,17 A15,15 0 0 1 17,2 Z" android:fillColor="{kachel}"/>
    <group>
{striche_xml(striche)}
    </group>
</vector>
''')
    if schluessel == "mac":
        # Adaptives App-Symbol: Kachel als Hintergrund, Zeichen im 108er-Raster
        # so gross wie die Kachel im 64er-Raster (60 -> 72 dp sichtbarer Bereich).
        vorne = f'''<vector {NS}
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <group android:scaleX="1.2" android:scaleY="1.2" android:translateX="15.6" android:translateY="15.6">
{{striche}}
    </group>
</vector>
'''
        (gen / "drawable" / "ic_launcher_vorne.xml").write_text(vorne.replace("{striche}", striche_xml(striche)))
        (gen / "drawable" / "ic_launcher_einfarbig.xml").write_text(
            vorne.replace("{striche}", striche_xml(striche, "#FFFFFFFF")))
        # Meldungssymbol: nur weisse Striche, auf den Inhalt zugeschnitten.
        (gen / "drawable" / "ic_meldung.xml").write_text(f'''<vector {NS}
    android:width="24dp" android:height="24dp" android:viewportWidth="48" android:viewportHeight="48">
    <group android:translateX="-8" android:translateY="-8">
{striche_xml(striche, "#FFFFFFFF")}
    </group>
</vector>
''')
(gen / "values" / "farben_generiert.xml").write_text(f'''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_hinten">{farben["mac"]}</color>
</resources>
''')
(gen / "mipmap-anydpi-v26" / "ic_launcher.xml").write_text(f'''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon {NS}>
    <background android:drawable="@color/ic_launcher_hinten"/>
    <foreground android:drawable="@drawable/ic_launcher_vorne"/>
    <monochrome android:drawable="@drawable/ic_launcher_einfarbig"/>
</adaptive-icon>
''')

print(f"-PyepRechner={json.dumps(rechner, separators=(',', ':'))}")
print(f"-PyepPushBruecke=https://{rollen['dienste']['tailnet']}")
if Path(firebase).is_file():
    fb = json.load(open(firebase))
    client = next(c for c in fb["client"] if c["client_info"]["android_client_info"]["package_name"] == paket)
    print(f"-PyepFirebaseAppId={client['client_info']['mobilesdk_app_id']}")
    print(f"-PyepFirebaseApiKey={client['api_key'][0]['current_key']}")
    print(f"-PyepFirebaseProjekt={fb['project_info']['project_id']}")
    print(f"-PyepFirebaseSender={fb['project_info']['project_number']}")
else:
    print("Ohne Firebase-Client: App baut ohne Push", file=sys.stderr)
PY
)
ARGS=("${(@f)EIGENSCHAFTEN}")
ARGS+=("-PyepVersionCode=$(date +%y%m%d%H)" "-PyepVersionName=1.0.$(date +%Y%m%d.%H%M)")
if [[ -f $SIGNATUR ]]; then
  ARGS+=("-PyepSignatur=$SIGNATUR" "-PyepSignaturBasis=$SZ")
fi

cd "$HIER"
if [[ ${1:-} == --debug ]]; then
  # installDebug spielt sonst auf JEDES verbundene Geraet, auch Testhandys.
  if [[ -z ${ANDROID_SERIAL:-} && $(adb devices | grep -c $'\tdevice$') -ne 1 ]]; then
    echo "Mehrere oder keine Geraete: ANDROID_SERIAL=<serial> setzen (adb devices)" >&2
    exit 1
  fi
  ./gradlew --quiet "${ARGS[@]}" testDebugUnitTest installDebug
  adb shell am start -n "$PAKET/.MainActivity"
  exit 0
fi

./gradlew --quiet "${ARGS[@]}" testReleaseUnitTest assembleRelease
APK="$HIER/app/build/outputs/apk/release/app-release.apk"
[[ -f $APK ]] || APK="$HIER/app/build/outputs/apk/release/app-release-unsigned.apk"
cp "$APK" "$HOME/Desktop/Yep-Cockpit.apk"
echo "APK: $HOME/Desktop/Yep-Cockpit.apk"
