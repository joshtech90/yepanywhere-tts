# Cockpit-Arbeitspakete

Stand: 24. September 2026

Basis: `034026b9da89e60e09e2de2f034075b3e9f2eadc`

Statuswerte: **offen**, **in Arbeit**, **umgesetzt**, **blockiert**.

Jedes Paket soll in einem Zug implementierbar sein und eine eigene sichtbare
oder automatisierte Abnahme besitzen. Die Reihenfolge ist empfohlen; ein
spaeteres Paket darf nur vorgezogen werden, wenn seine genannten
Voraussetzungen bereits erfuellt sind.

## 1 — Cockpit-Rahmenroute und Architekturgrenze

Status: **umgesetzt**

Umfang:

- neue, lazy geladene Route `/cockpit` im lokalen und direkten Remote-Client,
  plus `/-/relay/:relayUsername/cockpit` im Relay-Modus;
- eigener Cockpit-Rahmen unter `packages/client/src/cockpit/`, ohne
  `NavigationLayout` und ohne Aenderung des Standard-Einstiegs;
- kleine, reine Navigationsgrenze fuer direkte und Relay-Pfade;
- Remote-Routenklassifikation und Preload-Test, damit `cockpit` weder als
  alter Relay-Benutzername noch als Bestandslayout behandelt wird;
- keine Server- oder Shared-Aenderung.

Einzeln pruefbar durch:

- Unit-Tests fuer direkte und Relay-Navigation;
- Unit-Test fuer das Laden von `cockpitPage` ohne `layouts`;
- Komponenten-Smoke-Test fuer die neue Seite;
- Client-Typecheck, Lint, CSS-Module-Check und Client-Build;
- Browser-Aufruf der drei Routen und Ruecknavigation zu Bestandsseiten.

Ergebnis dieses Zugs: Die neue Oberflaeche hat einen eigenen Einstieg und eine
eigene CSS-Module-Grenze; die vorhandenen Seiten bleiben unveraendert
erreichbar. Geschaeftsdaten werden noch nicht im Cockpit dargestellt.

## 2 — Cockpit-Theme, Akzentfarben und Shell-Zustaende

Status: **offen**

Voraussetzung: Paket 1.

Umfang:

- Cockpit-eigene semantische Design-Tokens fuer Light und hochwertigen Dark
  Mode, ohne Wachstum der globalen Bestandsstyles;
- drei bis fuenf Akzentpaletten mit browserlokaler Auswahl;
- Desktop-Sidebar, mobile Navigation, leerer Inhalt, Laden, Offline und Fehler
  als echte Shell-Zustaende;
- gemeinsame Fokus-, Hover-, Touch- und Reduced-Motion-Regeln.

Einzeln pruefbar durch:

- Komponenten-/Storage-Tests fuer Theme und Akzentwahl;
- CSS-Architekturpruefung;
- visuelle Captures bei 1000x600 und 375x812, jeweils hell und dunkel;
- Tastaturnavigation und sichtbarer Fokus ohne Maus.

## 3 — Projekt- und Session-Sidebar auf dem vorhandenen Summary-Core

Status: **offen**

Voraussetzung: Pakete 1 und 2.

Umfang:

- source-gebundener Cockpit-Adapter auf den vorhandenen Summary Store;
- Gruppierung nach Projekt/Repo, letzte Aktivitaet, Pin/Favorit und klare
  Statusprojektion fuer aktiv, fertig, Approval/Frage, Fehler und offline;
- lokale Sidebar-Suche ueber bereits geladene Zusammenfassungen;
- keine Transcript-Abfragen nur fuer das Zeichnen der Sidebar.

Einzeln pruefbar durch:

- Adaptertests mit kollidierenden IDs aus zwei Sources;
- Status- und Sortiertests;
- sequentieller Tipptest: jeder Buchstabe der Suche ist innerhalb 100 ms im
  Feld sichtbar, auch waehrend Summary-Updates eintreffen;
- Desktop-/Mobil-Captures mit grossen und leeren Katalogen.

## 4 — Globale Suche ueber Sessions und Inhalte

Status: **offen**

Voraussetzung: Paket 3.

Umfang:

- Cockpit-View-Modell ueber die vorhandene All-Sessions-Suche und deren
  Capability-/Coverage-Zustaende;
- Ergebnisgruppen pro Sitzung mit ehrlicher Teilabdeckung;
- Auswahl und Suche bleiben stabil, wenn neue Treffer eintreffen;
- bekannte Gaps `all-sessions-search-index` und
  `all-sessions-search-ci-failures` werden nicht durch eigene Scans umgangen.

Einzeln pruefbar durch:

- bestehende Suchfixtures plus Cockpit-Adaptertests;
- fruehe Eingabe vor Capability-Antwort;
- neue Treffer waehrend der Suche, Auswahl und 375-Pixel-Layout;
- keine verlorenen Tastenanschlaege.

## 5 — Read-only Session-Detail und Vorlesen

Status: **offen**

Voraussetzung: Paket 3.

Umfang:

- Cockpit-Adapter auf den kanonischen Session-Detail-Store und dessen
  Retain-/Release-Lebenszyklus;
- ruhige Darstellung von User-/Assistant-Text, Thinking und grundlegenden
  Statusgrenzen;
- Live-/Reload-Paritaet, Pagination und Reconnect ohne zweiten Transcript-
  Cache;
- Vorlesen ueber `readAloud.ts` und die vorhandenen TTS-Routen, einschliesslich
  Stop und genau einer appweiten Wiedergabe.

Einzeln pruefbar durch:

- Store-/Adaptertests fuer warmen Ruecksprung, Catch-up und Source-Wechsel;
- TTS-Controller-Test mit Plan, Chunk-Prefetch und Stop;
- Captures einer langen Antwort auf Desktop und Mobil;
- Nachweis, dass der alte `TextBlock`-Vorleseknopf weiter funktioniert.

## 6 — Tool Calls, Shell, Dateiaenderungen und Diff-Ansicht

Status: **offen**

Voraussetzung: Paket 5.

Umfang:

- kompakte, aufklappbare Cockpit-Projektion vorhandener Tool-Display-Daten;
- Shell-Befehl, Laufstatus und Exit-Status ohne Terminal-Optik im Normalzustand;
- Dateiaenderungen und bestehende Diff-Projektion in einer Cockpit-eigenen
  Ansicht;
- unbekannte Provider-Tools bleiben sicher und sichtbar, nicht interpretiert.

Einzeln pruefbar durch:

- vorhandene Claude-/Codex-Capture-Fixtures und unbekannte Tool-Varianten;
- Fehler-, Abbruch-, langer Output- und Multi-Datei-Faelle;
- semantische Browsertests fuer Auf-/Zuklappen und Diff-Navigation;
- visuelle Desktop-/Mobil-Abnahme.

## 7 — Composer mit Prompt, Attachments, Queue und Steer

Status: **offen**

Voraussetzung: Pakete 3 und 5.

Umfang:

- lokaler Draft als unmittelbarer Eingabebesitzer;
- vorhandene Upload-/Attachment-Pipeline;
- providerfaehige Send-, Queue- und Steer-Aktionen mit serverbestaetigten
  Zustaenden;
- Prompt-History und haeufige Prompts als spaeter erweiterbare lokale Quelle;
- Provider, Modell und Effort sichtbar; Wechsel ueber vorhandene Aktionen und
  Schutzdialoge.

Einzeln pruefbar durch:

- Zeichen-fuer-Zeichen-Eingabe unter Streaming und Sidebar-Updates, jedes
  Zeichen innerhalb 100 ms sichtbar;
- Send/Queue/Steer pro unterstuetztem Provider und ehrlicher Fallback;
- Attachment-Erfolg, Fehler, Abbruch und erneuter Versuch;
- mobile Tastatur, Safe Area und Desktop-/Mobil-Captures.

## 8 — Approvals, Fragen und Interrupt/Stop

Status: **offen**

Voraussetzung: Paket 7.

Umfang:

- prominente, source-/session-gebundene Approval- und Fragekarten;
- Accept/Reject/Antwort mit Pending-, Erfolg-, Fehler- und veraltetem Zustand;
- Interrupt/Stop bleibt auch bei schneller Ereignisfolge erreichbar;
- keine optimistische Behauptung, dass der Provider eine Aktion angenommen
  hat.

Einzeln pruefbar durch:

- Claude-, Codex- und unbekannte Approval-Arten;
- Doppelclick, Reconnect, bereits beantwortete Anfrage und Serverfehler;
- Message-Storm-Szenario aus dem offenen Gap: Stop bleibt bedienbar;
- visuelle und tastaturbasierte Abnahme.

## 9 — Session-Organisation, Pins und Prompt-History

Status: **offen**

Voraussetzung: Pakete 3 und 7.

Umfang:

- Favoriten/Pins auf vorhandenen Metadaten, soweit vorhanden;
- Cockpit-eigene gespeicherte Ansichten nur browserlokal und source-gebunden;
- Prompt-History und haeufige Prompts ohne Geschaeftsinhalte in Tests;
- klare Rueckfallanzeige, wenn ein aelterer Server eine Funktion nicht kennt.

Einzeln pruefbar durch:

- Source-Wechsel, gleiche Session-ID auf zwei Hosts, Reload und Entfernen eines
  Hosts;
- Storage-Migration/Fallback fuer unbekannte Versionen;
- mobile Bedienung ohne Praezisionstaps.

## 10 — Keyboard-Shortcuts und mobile Feinarbeit

Status: **offen**

Voraussetzung: Pakete 3 bis 8.

Umfang:

- dokumentierte Shortcuts fuer Suche, neue Sitzung, Composer, Queue, Stop und
  Navigation;
- keine Uebernahme von Tasten aus Texteingaben oder nativen Browserfunktionen;
- stabile mobile Viewport-, Safe-Area- und Tastatur-Geometrie;
- Touch-Ziele und Screenreader-Namen fuer alle primaeren Aktionen.

Einzeln pruefbar durch:

- Shortcut-Matrix mit Fokus in und ausserhalb editierbarer Felder;
- Android-/iOS-aehnliche Viewport-Resize-Faelle im Browser;
- sequentielle Eingabe und Fokus-Restore;
- Desktop-/Mobil-Captures aller Hauptzustaende.

## 11 — Umschaltpunkt, Alltagstest und Upstream-Merge-Probe

Status: **offen**

Voraussetzung: alle Pakete, die Joscha fuer den Alltag als notwendig markiert.

Umfang:

- optionaler, ruecknehmbarer Standard-Einstieg ins Cockpit;
- sichtbarer Wechsel zur bisherigen Oberflaeche;
- Alltagstest mit echten, vom Supervisor bereitgestellten Sitzungen fuer
  Claude und Codex, direkt und per Relay;
- Probe-Merge eines aktuellen YepAnywhere-Upstreams und Dokumentation der
  tatsaechlichen Konfliktstellen;
- Entscheidung ueber Beibehalt, Wartungsmodus oder spaetere Entfernung der
  alten UI.

Einzeln pruefbar durch:

- frisches Profil, bestehendes Profil und Rueckweg;
- kompletter Schrankenlauf und Browser-E2E;
- dokumentierte Merge-Konfliktzahl und Anpassungen nur an den benannten
  Integrationspunkten;
- Joschas ausdrueckliche Freigabe vor jeder Entfernung der alten UI.

## Naechstes Paket

Als Naechstes ist **Paket 2 — Cockpit-Theme, Akzentfarben und
Shell-Zustaende** vorgesehen. Es veraendert noch keine Geschaeftlogik und kann
die visuelle Richtung mit Light/Dark- und Mobil-Captures frueh festlegen.
