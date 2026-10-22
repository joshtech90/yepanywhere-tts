# Yep Cockpit für Android (Fork-eigen)

Schlanke Android-App um die beiden Cockpits dieses Forks (Mac und aihub), das
Gegenstück zu `packages/mac-cockpit`. Sie ersetzt nicht `packages/android` von
upstream: jene App zeigt die normale Yep-Oberfläche und pusht über den
öffentlichen Upstream-Broker. Diese zeigt `/cockpit` der eigenen Server im
Tailnet und bringt, was eine Browser-App nicht kann. Vertrag:
[docs/cockpit/ARCHITEKTUR.md](../../docs/cockpit/ARCHITEKTUR.md#android-app-yep-cockpit-22102026).

```bash
packages/android-cockpit/build.sh            # Release bauen, APK nach ~/Desktop/Yep-Cockpit.apk
ANDROID_SERIAL=emulator-5554 packages/android-cockpit/build.sh --debug   # bauen und aufspielen
```

`--debug` verweigert sich, wenn mehrere Geräte verbunden sind und
`ANDROID_SERIAL` fehlt; `installDebug` spielte sonst auf jedes Gerät.

## Was die App kann

- Je Rechner eine WebView; der Rechnerwechsel-Knopf im Cockpit schaltet die
  Ansicht. Streifen hinter der Statusleiste in der Kachelfarbe des Rechners.
- Push „Fertig“ (mit Sitzungstitel und Anfang der finalen Antwort) und
  „Wartet auf dich“, auch bei geschlossener App. Tippen öffnet die Sitzung,
  „Antworten“ schickt Text direkt an sie.
- Teilen aus anderen Apps in „Neue Sitzung“ (Text, Links, Dateien),
  Schnellstart „Neu · Mac/aihub“ am App-Symbol, Diktat, Datei-Upload,
  Downloads.

## Push-Weg

```
Yep-Server ─Web Push (aes128gcm)─▶ Brücke im Smartzone-Push-Dienst (aihub)
           ─FCM data {r, wp}─▶ PushDienst ─entschlüsseln─▶ Meldung
```

Am Yep-Server ändert sich dafür nichts: die App ist ein normales Web-Push-Abo.
Den privaten Schlüssel hat nur die App (Android Keystore). Brücke:
`Smartzone OS/tools/push` (`send_webpush`) und `cockpit/cockpit.py`
(`/api/push/webpush/...`), Firebase-Projekt `smartzone-cockpit-push`.

## Was von außerhalb kommt

Dieses Repo ist öffentlich. `build.sh` holt beim Bauen:

- Rechneradressen aus `AI Worker/hosts/rollen.json`,
- Symbole und Farben aus `AI Worker/hosts/cockpit-icons/<rechner>/zeichen.svg`
  (nach `app/src/generiert/`, nicht eingecheckt),
- den Firebase-Client aus `Smartzone OS/cockpit-apps/yep-cockpit-google-services.json`
  (fehlt er, baut die App ohne Push),
- die Signatur aus `Smartzone OS/cockpit-apps/signing/` (Smartzone-Release-Schlüssel).

## Diagnose

Log-Tags `YEPC_PUSH`, `YEPC_MAIN`, `YEPC_ANTWORT`:
`adb logcat -s YEPC_PUSH YEPC_MAIN YEPC_ANTWORT`. Die WebViews sind über
`chrome://inspect` erreichbar (`webview_devtools_remote_<pid>`).

Bewusst ohne Jetpack Compose: die App hat außer einem Auswahldialog keine
eigene Oberfläche.
