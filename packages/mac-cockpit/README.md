# Yep Cockpit für macOS (Fork-eigen)

Schlanke native Mac-App um die beiden Cockpits dieses Forks (Mac und aihub).
Sie ersetzt nicht `packages/desktop` von upstream: jene App bringt einen
eigenen Server mit, diese zeigt nur die schon laufenden Server im Tailnet.

```bash
packages/mac-cockpit/build.sh             # bauen, nach /Applications legen
packages/mac-cockpit/build.sh --nur-bauen # nur nach packages/mac-cockpit/build/
```

- Adressen kommen beim Bauen aus `AI Worker/hosts/rollen.json` (Rollen
  `arbeitsplatz` und `dienste`, Port 3400). Nach einem Rechnerumzug neu bauen.
- Symbol: `AI Worker/hosts/cockpit-icons/mac/mac-app-1024.png`, erzeugt von
  `hosts/cockpit-icons/randlos.py` (randlos, Apple-Raster).
- Je Rechner eine eigene WebView; ⌘1/⌘2 oder der Umschalter oben wechseln,
  ohne neu zu laden. Der Rechnerwechsel-Knopf im Cockpit springt ebenfalls
  auf den passenden Reiter. Fremde Links öffnen im Standardbrowser.
- Fenster schließen versteckt nur; Mitteilungen und Dock-Zähler laufen
  weiter, bis die App mit ⌘Q beendet wird.

## Mitteilungen

Eine eingebettete WebView kann kein Web Push empfangen. Die App fragt deshalb
alle 6 s `GET /api/processes` auf jedem Rechner ab, mit den Anmelde-Cookies
genau dieses Rechners aus der WebView, und meldet:

- Wechsel von `in-turn` oder `waiting-input` nach `idle`, oder ein neuer
  `idleSince` (ein ganzer Durchgang lief zwischen zwei Abfragen): „Fertig“
- Wechsel nach `waiting-input`: „Wartet auf dich“

Die Regeln stehen in `Sources/Meldungen.swift`, geprüft von `./test.sh`.
Bekannte Grenze: Ein von Hand gestoppter Durchgang meldet ebenfalls „Fertig“,
außer das Fenster zeigt diese Sitzung gerade (der Server gibt den Grund in
`/api/processes` nicht heraus).

Die erste Abfrage nach dem Start oder nach einer Unterbrechung setzt nur den
Vergleichsstand. Keine Mitteilung, wenn das Fenster genau diese Sitzung
gerade im Vordergrund zeigt. Ein Klick öffnet die Sitzung im richtigen Reiter.
Der Dock-Zähler zeigt die Zahl der gerade arbeitenden Sitzungen beider Rechner.

Ohne Anmeldung in der App (aihub fragt einmal nach dem Passwort) bleibt die
Abfrage dieses Rechners still. Die Abfrage nutzt eine eigene Sitzung ohne
Cookie-Speicher und folgt keinen Weiterleitungen, damit die von Hand gesetzten
Cookies nie ein anderes Ziel erreichen.

Prüfhilfe ohne Bildschirmfreigabe:
`open --env YEP_SCHNAPPSCHUSS=/tmp/yep -a "Yep Cockpit"` legt nach dem Laden
`/tmp/yep-<Rechner>.png` ab.
