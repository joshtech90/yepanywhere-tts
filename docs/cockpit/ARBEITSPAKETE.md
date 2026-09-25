# Cockpit-Arbeitspakete

Stand: 24. September 2026

Ausgangsbasis der Cockpit-Serie:
`034026b9da89e60e09e2de2f034075b3e9f2eadc`

Basis dieses Umsetzungsschritts:
`413cde3ef397dc601891fae418643c0e50db3527`

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

Status: **umgesetzt**

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

Ergebnis dieses Zugs: Light, Dark und `Auto` sowie Blau, Violett, Teal und
Koralle sind unter der lokalen Cockpit-Wurzel waehlbar und gemeinsam
browserlokal gespeichert. Die Desktop-Sidebar wird mobil zu einer unteren
Safe-Area-Navigation. Leer, Laden, Offline und Fehler werden direkt aus dem
vorhandenen Transportstatus abgeleitet. Fokus, Touch-Ziele und Reduced Motion
sind in den Cockpit-CSS-Modulen enthalten; globale Bestandsstyles bleiben
unveraendert.

## 3 — Projekt- und Session-Sidebar auf dem vorhandenen Summary-Core

Status: **umgesetzt**

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

Ergebnis dieses Zugs: Der Cockpit-Adapter nutzt die vorhandenen Projekt- und
Global-Sessions-Feeds sowie den source-gebundenen Summary Store. Projekte und
Sitzungen erscheinen gruppiert mit Favorit, Nutzeraktivitaet und den Zustaenden
aktiv, fertig, Freigabe, Frage, Fehler und offline. Die lokale Suche bestaetigt
ihren Draft unabhaengig von Summary-Updates und filtert nur bereits geladene
Summaries; weitere Feed-Seiten werden ehrlich angezeigt und koennen
nachgeladen werden. Desktop nutzt die feste Sidebar, mobil steht derselbe
Katalog im Arbeitsbereich ueber der unteren Navigation. Transcript-Daten,
Server und Shared wurden nicht erweitert.

## 4 — Globale Suche ueber Sessions und Inhalte

Status: **umgesetzt**

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

Ergebnis dieses Zugs: Die Cockpit-Navigation oeffnet eine eigene globale
Suchansicht, deren lokaler Eingabe-Draft unabhaengig von Katalog-, Capability-
und Treffer-Updates bleibt. Titel verwenden die vorhandenen geladenen
Session-Summaries; User- und Assistant-Inhalte laufen ausschliesslich ueber die
bestehende, begrenzte All-Sessions-Suche mit deren Provider- und
Server-Capabilities. Treffer bleiben pro Sitzung gruppiert und behalten ihre
Entdeckungsreihenfolge, waehrend weitere Katalogseiten oder Live-Treffer
eintreffen. Laufende Katalogabdeckung, title-only Provider, alte Server,
Teilabdeckung und Aktualisierungsfehler werden sichtbar benannt. Es gibt keine
eigenen Transcript- oder Dateiscans und keine Server-/Shared-Erweiterung.

Nachbesserung dieses Zugs: Aus dem Suchfeld wechselt Pfeil runter direkt zum
stabil ausgewaehlten Treffer. Pfeil hoch und runter bewegen den Fokus zwischen
den Ergebnisgruppen; vom ersten Treffer fuehrt Pfeil hoch zurueck ins
Suchfeld. Pfeil hoch im Suchfeld bleibt eine native Eingabetaste. Spaet
eintreffende Treffer aendern diese Tastaturauswahl nicht.

## 5 — Read-only Session-Detail und Vorlesen

Status: **umgesetzt**

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

Ergebnis dieses Zugs: Sitzungen oeffnen jetzt unter der Cockpit-Route in einer
ruhigen read-only Gespraechsansicht. Der vorhandene `useSession`- und
Session-Detail-Store bleibt fuer Retain/Release, warmen Ruecksprung, Live-
Catch-up, Reconnect und Pagination verantwortlich; das Cockpit projiziert nur
User-, Assistant-, Thinking- und grundlegende Statuszeilen. Abgeschlossene
Markdown-Antworten nutzen die vorhandenen Server-Augments, aeltere Seiten
lassen sich mit stabiler Leseposition nachladen, und geladene Inhalte bleiben
bei Reconnect oder Aktualisierungsfehler sichtbar. Jede abgeschlossene
Assistant-Antwort kann ueber den bestehenden appweiten `readAloud`-Controller
gestartet und gestoppt werden; der alte `TextBlock` nutzt unveraendert denselben
Controller. Server und Shared-Protokoll wurden nicht erweitert. Das geforderte
Seed-Skript erzeugt zehn vollstaendig erfundene Claude-/Codex-Sitzungen in drei
Projekten, darunter lange Markdown-Antwort, Thinking, Shell, Fehler,
Dateiaenderung und Diff-Vorschau fuer Paket 6.

## 6 — Tool Calls, Shell, Dateiaenderungen und Diff-Ansicht

Status: **umgesetzt**

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

Ergebnis dieses Zugs: Tool Calls erscheinen in der Cockpit-Gespraechsansicht
als ruhige, standardmaessig geschlossene Karten. Shell-Aufrufe zeigen Lauf-,
Fehler-, Abbruch- und fehlenden Ergebnisstatus; im Detail stehen Befehl,
Ausgabe, Fehlerausgabe und Exit-Code ohne Terminaloptik im normalen
Gespraechsfluss. Edit- und Write-Aufrufe projizieren vorhandene strukturierte
Hunks, Raw-Patches und Multi-Datei-Angaben in eine eigene begrenzte Diff-Ansicht
mit Dateinavigation und Zeilennummern. Unbekannte Provider-Tools bleiben mit
einem klaren Hinweis als escaped Input-/Ergebnistext sichtbar und werden nicht
interpretiert. Die Projektion arbeitet pro vorhandenem `RenderItem`; Server,
Shared-Protokoll, kanonischer Session-Store und Bestandsrenderer wurden nicht
geaendert.

## 7 — Composer mit Prompt, Attachments, Queue und Steer

Status: **umgesetzt**

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

Ergebnis dieses Zugs: Die Cockpit-Gespraechsansicht besitzt jetzt einen eigenen
ruhigen Composer mit source-/session-gebundenem lokalem Draft. Direkte
Nachrichten, providerfaehiges Steer und die serverautoritative Queue nutzen die
vorhandenen Session-Aktionen und markieren ihre Absicht explizit; Provider ohne
Steer-Unterstuetzung fallen ehrlich auf Queue zurueck. Dateien und Bilder laufen
ueber die bestehende Upload- und Bildverkleinerungs-Pipeline und zeigen
Fortschritt, Abbruch, Fehler und erneuten Versuch pro Datei. Provider, Modell
und Effort bleiben sichtbar; Modell- und Effortwechsel verwenden den
vorhandenen Konfigurationsdialog einschliesslich der Warnung bei langen
Kontexten. Ein Regressionstest tippt Zeichen einzeln unter wiederholten
Eltern-Updates und fordert fuer jedes Zeichen eine Bestaetigung unter 100 ms.
Der kanonische Session-Store, Server und Shared-Protokoll wurden nicht
dupliziert oder erweitert.

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

Status: **umgesetzt**

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

Ergebnis dieses Zugs: Favoriten lassen sich direkt in der Cockpit-Sidebar ueber
die vorhandene serverseitige Session-Metadatenroute setzen und entfernen. Die
Markierung aendert sich erst nach Serverbestaetigung; alte Server erhalten eine
sichtbare Rueckfallanzeige. Suchtext und Favoritenfilter koennen als benannte,
browserlokale Ansichten gespeichert werden und bleiben strikt source-gebunden.
Beim Entfernen eines gespeicherten Hosts werden nur dessen Ansichten und
Prompt-Verlauf bereinigt. Der Composer zeigt die letzten sowie mehrfach
verwendete Prompts, uebernimmt eine Auswahl nur in den Draft und erlaubt das
gezielte Entfernen. Version-1-Verlauf wird auf Nutzungszaehler migriert,
unbekannte Versionen fallen sicher leer zurueck. Zusaetzlich verwenden die
Cockpit-Zaehler nun eine korrekte Einzahl, Projekt- und Suchtrefferlinks besitzen
auch mobil einen stabilen zugaenglichen Namen, und die sequentiellen Suchtests
pruefen die geforderte 100-ms-Bestaetigung pro Zeichen.

Nachbesserung dieses Zugs: Der Prompt-Verlauf ist nun als benannter Dialog mit
seinem Ausloeser verknuepft. Escape schliesst ausschliesslich diesen Verlauf,
statt bis zum globalen Stop-Kuerzel durchzureichen, und gibt den Fokus an den
Ausloeser zurueck. Ein Klick ausserhalb schliesst das Panel ebenfalls, ohne den
angeklickten Arbeitsbereich wieder zu verlassen.

Nachbesserung dieses Zugs: Der offene Prompt-Verlauf faengt Escape jetzt auch
dann ab, wenn Joscha den nicht-modalen Dialog zuvor per Tab verlassen hat. So
kann ein Fokuswechsel innerhalb des Composers nicht versehentlich den globalen
Stop ausloesen; geschlossen wird weiterhin nur der Verlauf, danach kehrt der
Fokus zu seinem Ausloeser zurueck.

Nachbesserung dieses Zugs: Der Prompt-Verlauf besitzt jetzt eine lokale Suche,
die beim Oeffnen sofort fokussiert ist. Jeder Tastenanschlag filtert die bis zu
20 source-gebundenen Eintraege unmittelbar; ein leerer Trefferstand wird klar
benannt. Die Auswahl uebernimmt weiterhin nur Text in den Entwurf und sendet
nichts automatisch.

Nachbesserung dieses Zugs: Pfeil runter wechselt aus dem Verlauf-Filter direkt
zum ersten sichtbaren Prompt. Pfeil hoch und runter bewegen den Fokus zwischen
den gefilterten Verlaufseintraegen; vom ersten Eintrag fuehrt Pfeil hoch zum
Filter zurueck. Enter behaelt seine bestehende, rein uebernehmende Aktion.

## 10 — Keyboard-Shortcuts und mobile Feinarbeit

Status: **umgesetzt**

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

Ergebnis dieses Zugs: Eine sichtbare, per `?` erreichbare Hilfe dokumentiert
die Cockpit-Kuerzel fuer Suche, neue Sitzung, Composer, Queue, Stop und
Navigation. Buchstaben- und Slash-Kuerzel bleiben in Eingabefeldern sowie bei
Browser-Modifikatoren wirkungslos; Queue verwendet im Composer gezielt
`Strg/Befehl+Eingabe`. `Escape` aktiviert ausschliesslich den bedienbaren,
serverautoritativen Stop-Knopf aus Paket 8 und bleibt sonst frei. Suche und
Shortcut-Hilfe stellen den Fokus nach dem Schliessen wieder her. Auf Mobilgeraeten
folgt die Shell der sichtbaren Viewport-Hoehe und ihrem Versatz, sodass
Bildschirmtastatur, Safe Area, untere Navigation und Composer keine zweite
Dokument-Scrollflaeche erzeugen. Primaere mobile Aktionen besitzen mindestens
44 Pixel Zielgroesse und stabile Screenreader-Namen. Reine Adapter-,
Komponenten- und Resize-Tests decken die Shortcut-Matrix, editierbare Felder,
Queue, Fokus-Restore und Android-/iOS-aehnliche Viewport-Aenderungen ab.

Nachbesserung dieses Zugs: Die Shortcut-Hilfe ist nun auch semantisch modal.
Tab und Umschalt+Tab bleiben innerhalb der Hilfe, Escape und ein Klick auf den
abgedunkelten Hintergrund schliessen sie, und der ausloesende Knopf erhaelt den
Fokus zurueck. Klicks im Hilfefenster selbst schliessen es nicht.

Nachbesserung dieses Zugs: Solange die Shortcut-Hilfe geoeffnet ist, sind
Navigation und Arbeitsbereich jetzt auch fuer Browser und assistive Technik
explizit inaktiv. Beim Schliessen wird diese Sperre vor der Fokus-Rueckgabe
aufgehoben, sodass der ausloesende Knopf wieder verlaesslich fokussiert wird.

Nachbesserung dieses Zugs: Oeffnet Joscha Suche oder Shortcut-Hilfe per
Tastatur, kehrt der Fokus beim Schliessen jetzt an das zuvor fokussierte
Cockpit-Element zurueck. Nur wenn dieses Element inzwischen entfernt wurde,
springt er zum sichtbaren Such- beziehungsweise Shortcut-Knopf. Mausaufrufe
behalten den jeweiligen Navigationsknopf als eindeutigen Ausloeser.

Nachbesserung dieses Zugs: Auf schmalen Viewports bleiben Shortcut-Hilfe und
Prompt-Verlauf nun innerhalb der bereits gemessenen sichtbaren Cockpit-Wurzel.
Damit folgt die Hilfe dem durch Browserleiste oder Bildschirmtastatur
verkleinerten Ausschnitt, waehrend der Verlauf direkt ueber seinem
Composer-Ausloeser aufklappt und nicht hinter der Tastatur liegen bleibt.

Nachbesserung dieses Zugs: Die globale Suche ist fuer Joschas
Tastaturarbeitsweise jetzt ohne Tab-Kette bedienbar. Pfeiltasten wechseln vom
Suchfeld in die stabile Trefferliste und dort zeilenweise weiter; die
vorhandenen Links behalten Enter als normale Oeffnungsaktion.

Nachbesserung dieses Zugs: Verlaesst Joscha die globale Suche bewusst ueber
den Cockpit-Markenlink oder ein Navigationsziel, wird die Suche geschlossen,
ohne den Fokus danach zum frueheren Ausloeser zurueckzuziehen. Das dekorative
Markenzeichen wird dabei nicht mehr als Teil des Screenreader-Namens vorgelesen.

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

Als Naechstes ist fuer Fenster 2 **Paket 10 — Keyboard-Shortcuts und mobile
Feinarbeit** vorgesehen. Seine Voraussetzung Paket 8 liegt bei Fenster 1; bis
zu dessen Zusammenfuehrung bleibt Paket 10 offen.
