# Cockpit-Architektur

Stand: 24. September 2026

Ausgangsbasis der Cockpit-Serie:
`034026b9da89e60e09e2de2f034075b3e9f2eadc`

Basis dieses Umsetzungsschritts:
`413cde3ef397dc601891fae418643c0e50db3527`

## Ziel und Leitplanken

Das Cockpit ist eine neue, ruhige Bedienoberflaeche fuer Joschas persoenlichen
Workflow. Es ersetzt nicht den Yep-Anywhere-Core und vorerst auch nicht die
bisherige Oberflaeche. Claude-/Codex-Integration, Sitzungslebenszyklus,
Streaming, Reconnect, Approvals, Queues und Provider-Kompatibilitaet bleiben
bei ihren heutigen Besitzern.

Die wichtigste Wartungsregel lautet:

> Das Cockpit darf neue Darstellung und neue Interaktion besitzen, aber keinen
> zweiten Session-, Transport- oder Provider-Core aufbauen.

Damit Upstream-Merges ueberschaubar bleiben, sollen fast alle Cockpit-Aenderungen
in neuen Dateien unter `packages/client/src/cockpit/` liegen. Beruehrungen des
bestehenden Clients bleiben auf wenige, benannte Integrationspunkte begrenzt.

## Bestehende Architektur

### Server

Der Server ist eine Hono-Anwendung. `packages/server/src/app.ts` montiert die
REST-, SSE- und WebSocket-Routen. `Supervisor` und ein `Process` pro Sitzung
besitzen Provider-Prozess, Queue, Approval-Fluss, Replay und Fan-out. Der
`EventBus` verteilt globale Aktivitaet wie Datei-, Prozess- und
Sitzungsaenderungen.

Fuer das Cockpit wichtige Folgerungen:

- Der Server ist die Autoritaet fuer Provider- und Sitzungszustand.
- Reconnect, Replay und Provider-Unterschiede duerfen nicht in der neuen UI
  nachgebaut werden.
- Neue Serverrouten sind nur zulaessig, wenn eine benoetigte, providerneutrale
  Operation ueber die vorhandenen Client-APIs wirklich nicht ausdrueckbar ist.
- Vorlesen ist bereits vorhanden: `TtsService`, `ttsChunking.ts` und
  `routes/tts.ts` stellen `/api/tts/status`, `/plan` und `/synthesize` bereit.
  Das Cockpit nutzt spaeter denselben Client-Controller in
  `packages/client/src/lib/readAloud.ts`.

### Shared

`packages/shared` enthaelt providerneutrale Typen, Protokollwerte, Schemas und
reine Transformationslogik. Das Paket kennt weder React noch eine konkrete
Oberflaeche. Der experimentelle Simple-Client-Vertrag ist ein gutes Beispiel
fuer einen kleinen, explizit versionierten Vertrag, ist aber absichtlich
read-only und inhaltlich reduziert.

Fuer das Cockpit wichtige Folgerungen:

- Shared bleibt UI-frei.
- Ein neuer Shared-Typ ist nur dann sinnvoll, wenn Client und Server denselben
  neuen Drahtvertrag brauchen; reine View-Modelle bleiben im Cockpit.
- YA-Sitzungs-IDs bleiben die oeffentlichen IDs. Provider-native IDs werden
  nicht zu Navigations- oder Speicher-IDs des Cockpits.

### Client-Core

Der Client hat zwei Startpunkte: `main.tsx` fuer den lokalen Client und
`remote-main.tsx` fuer direkte beziehungsweise Relay-Verbindungen.
`App`/`RemoteApp` besitzen die querschnittlichen Provider fuer Authentifizierung,
Source Runtime, Summary Store, Inbox, Schema-Pruefung, Toasts und
Verbindungsstatus.

Die bisherige sichtbare App beginnt darunter in `NavigationLayout`. Dort
liegen Sidebar, Routenrahmen und die alten Seiten. Das ist die entscheidende
Naht: Eine neue Route kann dieselben Core-Provider benutzen, ohne das alte
Layout zu mounten.

Weitere tragende Grenzen:

- `SourceRuntimeContext` und die Source-Transport-Arbeit halten lokale,
  direkte und Relay-Verbindungen aus den Views heraus.
- Der `clientSummaryStore` besitzt source-gebundene Sitzungs- und
  Projektzusammenfassungen.
- Der Session-Detail-Store besitzt kanonischen, source-/project-/session-
  gebundenen Detailzustand. Token-schnelles Streaming und Scrollzustand bleiben
  aus Leistungsgruenden bei ihren spezialisierten Besitzern.
- `api/client.ts`, Session-Hooks und Aktionshelfer sind die heutigen Adapter zu
  REST, SSE und WebSocket. Das Cockpit soll sie hinter eigenen Ports aufrufen,
  statt ihre Implementierungsdetails ueber viele neue Komponenten zu verteilen.

### Bestehende Simple-Client-Vorschau

`/-/preview` ist bewusst eine kleine, unabhaengige, read-only Vorschau auf den
experimentellen Conversation-Vertrag. Sie beweist Multi-Source-Isolation und
eine reduzierte Darstellung, bildet aber Approvals, reichhaltige Tool Calls,
Dateien, Diffs, Queue/Steer und den vollen Composer nicht ab. Sie ist deshalb
kein ausreichendes Fundament fuer Joschas vollwertige Hauptoberflaeche.

## Entscheidung

Das Cockpit wird als **vertikale Feature-Insel im bestehenden
`@yep-anywhere/client`** gebaut:

```text
main.tsx / remote-main.tsx
  -> lazy CockpitPage                 einziger Routeneinstieg
     -> Cockpit-Kompositionswurzel    bindet vorhandenen Core an Cockpit-Ports
        -> Cockpit-Anwendungslogik    UI-unabhaengige View-Modelle/Aktionen
           -> Cockpit-Ports           kleine, stabile eigene Schnittstellen
        -> Cockpit-UI                 eigene Komponenten und CSS Modules

vorhandener Client-Core
  -> Transport, Auth, Stores, Session Detail, Aktionen, readAloud

Server / Shared
  -> unveraendert, solange vorhandene Vertraege ausreichen
```

Die opt-in Route ist `/cockpit`. Im Remote-Client existiert dieselbe Route
direkt und unter `/-/relay/:relayUsername/cockpit`. Sie laedt die
Cockpit-Seite ohne `NavigationLayout`; `App` beziehungsweise `RemoteApp`
stellen weiterhin Authentifizierung, Verbindung und die source-gebundenen
Core-Dienste bereit. Die bisherige Oberflaeche bleibt unter ihren bestehenden
Routen erreichbar und bleibt zunaechst der Standard.

### Erlaubte Abhaengigkeitsrichtung

- `cockpit/ui` darf React, Router, i18n, eigene Styles und Cockpit-View-Modelle
  verwenden.
- Die Cockpit-Kompositionswurzel darf gezielt vorhandene Hooks, Stores und
  Aktionshelfer importieren und in Cockpit-Ports uebersetzen.
- Bestehende Core-Module importieren keine Cockpit-UI. Ausnahmen sind nur die
  lazy Routenregistrierung und generische Routenklassifikation.
- Cockpit-Komponenten importieren keine Server- oder Provider-Klassen und
  lesen keine nativen Transcript-Dateien.
- Ein vorhandenes visuelles Bauteil wird nur wiederverwendet, wenn es bereits
  eine stabile, datenorientierte Komponentengrenze besitzt. Ganze alte Seiten
  oder das alte Layout werden nicht in das Cockpit eingebettet.

### Warum diese Trennung merge-freundlich ist

1. Der groesste Teil des Neubaus entsteht in einem neuen Verzeichnis. Upstream
   und Cockpit bearbeiten dadurch selten dieselben Zeilen.
2. Lokaler, direkter und Relay-Client behalten ihre erprobten Transport- und
   Authentifizierungswege. Es gibt keinen zweiten Reconnect-Stack, der mit
   Upstream auseinanderlaufen kann.
3. Die alte UI bleibt funktionsfaehig. Einzelne Cockpit-Pakete koennen landen,
   ohne einen Big-Bang-Umschaltpunkt zu erzwingen.
4. Wenn Upstream einen Hook oder Store umbaut, muss normalerweise nur der
   Cockpit-Adapter angepasst werden, nicht jede Cockpit-Komponente.

### Darstellungsgrenze aus Paket 2

Das Cockpit besitzt Light/Dark und seine Akzentfarben vollstaendig unter der
lokalen CSS-Module-Wurzel. Die semantischen Cockpit-Tokens veraendern weder die
globalen Bestands-Themes noch deren eingefrorene Stylesheets. `Auto` wird im
Cockpit gegen die Systempraeferenz zu Light oder Dark aufgeloest; die konkrete
Darstellung steht als `data-theme` und `data-accent` nur an der Cockpit-Wurzel.

Theme und Akzent liegen zusammen in einem versionierten browserlokalen Record
`yep-anywhere-cockpit-appearance`. Unbekannte Versionen oder Werte fallen auf
`Auto` und Blau zurueck. Nicht verfuegbarer oder voller Browser-Speicher darf
die Seite nicht verhindern; die Wahl gilt dann fuer den laufenden Tab.

Die Shell liest ihren Zustand direkt aus dem vorhandenen
`SourceTransportStatusSnapshot`:

- `ready` zeigt den Projekt- und Sitzungskatalog aus Paket 3;
- `connecting` und `reconnecting` zeigen Laden bei stabiler Geometrie;
- `disconnected` zeigt Offline;
- ein von einem Transportkanal gemeldeter Fehler zeigt den Fehlerzustand.

Damit entstehen keine zweite Verbindungslogik und kein zweiter Store. Desktop
verwendet eine feste Sidebar; bis 700 Pixel wird dieselbe Navigation zu einer
Safe-Area-faehigen unteren Leiste. Fokus, Touch-Ziele und Reduced Motion werden
innerhalb derselben Feature-Grenze gepflegt.

`SourceTransportStatusSnapshot` ist als Ganzes kein gueltiger React-Snapshot:
`getSnapshot()` darf bei jedem Aufruf ein neues Objekt liefern. Cockpit-Hooks
mit `useSyncExternalStore` abonnieren deshalb nur abgeleitete primitive Werte
oder eine anderweitig referenzstabile Projektion. Ein Regressionstest deckt den
Fall ab, dass jeder Snapshot-Aufruf ein frisches Objekt zurueckgibt.

### Kataloggrenze aus Paket 3

`useCockpitCatalog` ist die Kompositionsgrenze zwischen bestehendem Client-Core
und Cockpit-Katalog. Die vorhandenen Hooks `useProjects` und
`useGlobalSessionsFeed` laden kompakte Projekt- und Sitzungssummen in den
source-gebundenen Summary Store. Der reine Adapter unter `cockpit/core` formt
daraus Projektgruppen und Cockpit-Status; er besitzt weder Transport- noch
Transcript-Logik und speichert keine zweite Kopie der Daten.

Source-Identitaet ist Bestandteil jedes Projekt- und Sitzungsschluessels des
View-Modells. Gleiche Projekt- oder Sitzungs-IDs zweier Hosts kollidieren daher
nicht. Eine Sitzung verlinkt bis Paket 5 weiterhin auf ihre vorhandene
Bestandsroute, waehrend die neue read-only Detailansicht noch fehlt.

Innerhalb einer Projektgruppe stehen Favoriten zuerst. Danach uebernimmt das
Cockpit die vorhandene Reihenfolge aus `useSidebarSessionOrder`, statt eine
zweite Chronologie fuer dieselben Summary-Daten zu erfinden. Der Status ist
eine separate Projektion mit der Prioritaet Offline, Fehler, Freigabe/Frage,
aktiv und fertig.

Die Sidebar-Suche filtert nur die bereits geladenen Summary-Daten nach Projekt,
Pfad, Sitzungstitel, Provider und Modell. Wenn der bestehende Feed weitere
Seiten kennt, nennt die UI diese Teilabdeckung und bietet explizites Nachladen
an. Inhalts- und Volltextsuche bleibt Paket 4; Paket 3 startet dafuer keine
Transcript-Abfragen und keine eigenen Dateiscans.

### Session-Detail-Grenze aus Paket 5

Cockpit-Sitzungen liegen unter
`/cockpit/projects/:projectId/sessions/:sessionId` und bleiben damit in der
Cockpit-Shell; ein eigener Link oeffnet weiterhin die unveraenderte
Bestandsansicht. Direkter und Relay-Client registrieren dieselbe lazy geladene
Route ohne `NavigationLayout`.

`useCockpitSessionDetail` ruft den vorhandenen `useSession`-Hook auf. Damit
bleiben Retain/Release des kanonischen Session-Detail-Stores, warmer
Ruecksprung, Pagination, Catch-up, Live-Stream und Reconnect bei ihren heutigen
Besitzern. Das Cockpit legt weder Transcript-Kopie noch eigenen
Reconnect-Zustand an. Der bestehende semantische
`buildSessionDetailRenderItems`-Adapter liefert stabile User-, Assistant-,
Thinking- und Statusobjekte; die Cockpit-Projektion filtert daraus nur die in
Paket 5 sichtbaren, read-only Zeilen. Tool Calls, Shell, Dateien und Diffs
bleiben im selben geladenen kanonischen Zustand und erhalten erst in Paket 6
ihre Cockpit-Darstellung.

Abgeschlossene Markdown-Antworten verwenden das bereits vom Server gelieferte
HTML-Augment. Waehrend eines Streams bleibt der Text eine guenstige lokale
Textdarstellung; kein Token wird in einen neuen breit abonnierten Cockpit-State
verschoben. Das Transcript folgt neuen Zeilen nur, solange der Leser am Ende
steht. Beim expliziten Nachladen aelterer Seiten bleibt die sichtbare Position
durch einen Hoehenausgleich erhalten; Reconnect zeigt den Status, behaelt aber
bereits geladene Zeilen sichtbar.

Vorlesen ruft direkt den bestehenden appweiten Controller in `readAloud.ts`
auf. Dessen Token stellt weiterhin genau eine Wiedergabe fuer alte und neue UI
sicher; Start, Chunk-Prefetch und Stop verwenden unveraendert `/api/tts/plan`
und `/api/tts/synthesize`. Stop loest nun auch die interne Warteoperation der
abgebrochenen Audiowiedergabe auf, damit kein offenes Wiedergabe-Promise
zurueckbleibt. Ein fehlgeschlagener Plan-, Synthese- oder Wiedergabeschritt
bleibt am Token des ausloesenden Cockpit-Knopfs sichtbar und kann dort erneut
gestartet werden; Stop oder der naechste Start loescht diesen Fehlerzustand.
Der vorhandene `TextBlock`-Knopf nutzt denselben Controller und bleibt dadurch
kompatibel.

Abgeschlossene Assistant-Antworten bieten daneben eine Cockpit-eigene
Kopieraktion fuer den bereits projizierten, unveraenderten Antworttext. Sie
verwendet die vorhandene Clipboard-Hilfe, besitzt nur lokalen Rueckmeldestatus
und fuehrt weder eine zweite Markdown-Projektion noch Transcript-Zustand ein.
User-Prompts verwenden dieselbe lokale Aktion und kopieren den bereits
projizierten Prompttext, ohne eine Prompt-History zu fuehren oder den
Composer-Draft zu veraendern.

### Werkzeugdarstellungs-Grenze aus Paket 6

Tool Calls bleiben Teil derselben kanonischen `RenderItem`-Folge wie Text und
Thinking. Eine reine Cockpit-Projektion formt jeweils nur einen Tool Call in
kompakte Shell-, Datei- oder generische Darstellungsdaten um; sie scannt weder
die Sitzung noch fuehrt sie Providerlogik aus. Die bekannte Alias-Normalisierung
fuer Bash, Edit und weitere Werkzeuge wird wiederverwendet.

Shell-Karten zeigen im geschlossenen Normalzustand nur Werkzeug, Kurzfassung und
serverbeobachteten Status. Befehl, Ausgabe, Fehlerausgabe und Exit-Code liegen
im explizit geoeffneten Detail. Edit/Write-Karten lesen vorhandene strukturierte
Hunks, Multi-Datei-Angaben und Raw-Patches in eine begrenzte Cockpit-Diff-
Projektion; die Dateiauswahl ist lokaler Ansichtsstatus und keine zweite
Datei- oder Git-Quelle. Unbekannte Provider-Tools werden nicht erraten: Name,
Input und Ergebnis bleiben als laengenbegrenzter, von React escaped dargestellter
Text sichtbar. Server, Shared-Vertrag und Bestandsrenderer bleiben unveraendert.
Wenn dieselbe Dateiaenderung strukturiert und als Raw-Patch vorliegt, hat die
strukturierte Darstellung Vorrang; Zeilen und Statistik werden nicht doppelt
gezaehlt. Alle Cockpit-eigenen Werkzeugtexte besitzen deutsche und englische
Katalogwerte.
Shell-Befehl, Standard- und Fehlerausgabe sowie die begrenzten Textdaten
unbekannter Werkzeuge erhalten lokale Kopieraktionen. Sie kopieren genau die
bereits projizierte Anzeige, besitzen nur voruebergehenden Rueckmeldestatus und
veraendern weder Tool-Daten noch Transcript-Zustand.
Die Datei-Diff-Ansicht bietet dieselbe lokale Aktion fuer die ausgewaehlte
Datei. Sie serialisiert ausschliesslich die bereits begrenzt projizierten
Hunk-, Kontext-, Plus- und Minuszeilen samt Markern; ein Dateiwechsler erzeugt
eine neue lokale Rueckmeldungsinstanz und kann keinen Erfolg der vorigen Datei
anzeigen.

### Composer-Grenze aus Paket 7

Der Cockpit-Composer bleibt ein Blatt unter derselben
`useCockpitSessionDetail`-Kompositionswurzel. Der Hook `useSession` wird daher
nur einmal pro geoeffneter Cockpit-Sitzung aufgerufen; sein kanonischer
Session-Zustand liefert Ownership, Prozesszustand, Pending-Echos und die
serverautoritative Deferred Queue. Das Cockpit besitzt nur den unmittelbar zu
bestaetigenden Texteingabe-Draft, Upload-Fortschritt und lokale Karten-Zustaende.

Direktes Senden, Steer und Queue verwenden die vorhandenen `resumeSession`-
beziehungsweise `queueMessage`-Aktionen und deren `deliveryIntent`. Wenn ein
Provider keine aktuelle Runde lenken kann, behauptet die UI das nicht, sondern
bietet Queue als Primaeraktion an. Attachments laufen durch denselben
source-gebundenen Transport und denselben Bild-Resize-/Upload-Helfer wie die
bisherige Oberflaeche; Fehler, Abbruch und Wiederholung bleiben pro Datei lokal
sichtbar, bis der Server einen Upload bestaetigt hat.

Der Draft ist source- und session-gebunden browserlokal gespeichert. Diese
kleine versionierte Grenze kann Paket 9 spaeter um Prompt-History erweitern,
ohne die Sendelogik oder den kanonischen Session-Store zu veraendern. Modell
und Effort werden ueber den vorhandenen `ModelSwitchModal` samt
Long-Context-Warnung geaendert; ein ruhiger Cockpit-Trigger ersetzt dabei nicht
die vorhandenen serverautoritativen Konfigurationsaktionen.

Source, Projekt und Sitzung bilden zugleich die React-Identitaet des Composers.
Ein Kontextwechsel demontiert deshalb seinen lokalen Draft-, Fehler- und
Attachment-Zustand, bricht laufende Uploads ab und laedt erst danach den Draft
des neuen Kontexts. Spaete Upload-Ergebnisse duerfen nicht in eine andere
Sitzung uebernommen werden.

Die Enter-Taste folgt derselben Eingabegrenze wie der bestehende Composer: Nur
ein unveraendertes, einmaliges Enter auf einem Desktop-Eingabegeraet sendet.
IME-Komposition, gehaltenes Enter, Zusatztasten und primaere Touch-Eingabe
bleiben Texteingabe und koennen keinen Draft versehentlich abschicken.

Datei-Paste und Drag-and-drop enden an derselben Attachment-Grenze wie der
Dateiauswahldialog. Der Cockpit-Composer nimmt dabei nur echte Dateiobjekte aus
Zwischenablage oder Drop an; normaler Text-Paste bleibt native Texteingabe und
beliebiges Clipboard-HTML wird nicht als Anhang interpretiert. Upload,
Bildverkleinerung, Fortschritt, Abbruch und Wiederholung bleiben Besitzer der
vorhandenen Composer-Pipeline.

### Aufmerksamkeits-Grenze aus Paket 8

`useSession` bleibt Eigentuemer der jeweils aktuellen `pendingInputRequest`.
Das Cockpit projiziert genau diese Anfrage in eine Approval- oder Fragekarte;
strukturierte Claude-, Codex- und providerneutrale Fragen werden dabei nur in
ein lokales View-Modell mit stabilen Frage-IDs, Optionen und Mehrfachauswahl
uebersetzt. Unbekannte Anfragearten bleiben als Approval mit escaped
Eingabedetails sichtbar, ohne Anbieterbedeutung zu erraten.

Accept, Reject und Antworten rufen unveraendert `respondToInput` auf. Ein
Doppelklick startet nie eine zweite Anfrage. Erfolg wird erst nach
Serverbestaetigung angezeigt; HTTP 400 gilt als veraltete Anfrage und loest
eine begrenzte Aktualisierung der aktuellen Serveranfrage aus. Andere Fehler
bleiben an der Karte sichtbar und lassen die Eingabe fuer einen erneuten
Versuch bestehen. Freitextantworten, insbesondere als geheim markierte, leben
nur im lokalen Komponentenzustand und werden nicht browserlokal gespeichert.

Dieser lokale Karten- und Stop-Zustand ist an Source, Projekt und Sitzung
gebunden. Ein Kontextwechsel demontiert ihn auch dann, wenn zwei Hosts dieselbe
Anfrage- oder Prozess-ID verwenden; Auswahl, Freitext und Rueckmeldungen duerfen
nicht in den naechsten Kontext uebernommen werden.

Transcript-Projektion ist auch im Cockpit nicht-dringende React-Arbeit. Live-
Anhaenge und Tail-Aktualisierungen duerfen deshalb ueber einen verzoegerten
Snapshot laufen, waehrend Status, Freigaben, Composer und Stop auf dem aktuellen
Session-Zustand bleiben. Praefixwechsel werden davon ausgenommen: Nachladen
aelterer Seiten, Trimming und ein ersetzter Sitzungskontext muessen gemeinsam
mit ihrer Scrollanker- beziehungsweise Identitaetskorrektur synchron sichtbar
werden.

Innerhalb eines spaeter dargestellten Tail-Snapshots werden die stabilisierten
RenderItems zugleich auf unveraenderte Cockpit-Zeilenidentitaeten abgebildet.
React kann dadurch alte User-, Assistant-, Werkzeug- und Grenzzeilen auslassen,
statt deren DOM bei jedem Live-Anhang erneut zu versoehnen; geaenderte
RenderItems erzeugen weiterhin neue Zeilenobjekte.

Ab zweihundert semantischen Cockpit-Zeilen begrenzt zusaetzlich die vorhandene
gemessene Transcript-Fensterung die wirklich gemountete Menge. Das Cockpit
uebergibt ihr nur stabile Zeilenschluessel und bleibt ansonsten Besitzer seiner
Darstellung; kanonische Eintraege werden weder abgeschnitten noch in einen
zweiten Store kopiert. Gemessene Platzhalter erhalten die Scrollgeometrie, und
ein Pagination-Anker wird bis zur Lesepositionskorrektur explizit im Fenster
gehalten. Diese Grenze umfasst nur das Transcript: Sitzungskopf, Freigaben,
Composer und Stop bleiben dauerhaft gemountet und direkt bedienbar.
Eine Zeile mit mehreren Thinking- oder Werkzeug-Aufklappern bleibt dabei so
lange als sparse Insel gemountet, wie mindestens einer dieser Aufklapper offen
ist. Das Schliessen eines Geschwister-Aufklappers darf einen noch offenen
Detailbereich weder demontieren noch seinen lokalen Offen-Zustand verlieren.

Interrupt/Stop ist eine direkte Schaltflaeche im festen Sitzungskopf und damit
nicht von Transcript-Aufklappzustand oder einem Menue abhaengig. Sie verwendet
zuerst den vorhandenen sanften Interrupt und faellt bei fehlender Unterstuetzung
oder Fehler auf den vorhandenen verifizierten Prozessabbruch zurueck. Nur ein
bestaetigter Abbruch setzt lokalen Besitz und Prozesszustand zurueck; bei einem
angenommenen sanften Interrupt bleibt das naechste Serverereignis die
Zustandsautoritaet. Der Knopf liegt ausserhalb der nicht dringenden
Transcript-Projektion, damit eine schnelle Nachrichtenfolge ihn nicht
verdraengt.

## Verworfene Alternativen

### Bestehende UI direkt umgestalten

Das waere anfangs schnell, aber fast jede Aenderung traefe stark bewegte
Upstream-Dateien wie `NavigationLayout`, `Sidebar`, `SessionPage`,
`MessageList` und die grossen Bestandsstyles. Merges wuerden dauerhaft
konfliktreich, und ein Rueckweg zur alten UI waere unklar. Daher verworfen.

### Eigenes Workspace-Paket `packages/cockpit`

Die Dateitrennung waere maximal, aber das Paket braeuchte kurzfristig einen
zweiten Vite-/Build-/Deployment-Einstieg und muesste Auth, Source Runtime,
Router-Basename, Service Worker und Remote-Kompatibilitaet erneut verdrahten.
Das verschiebt die Kopplung nur an eine schwerere Paketgrenze. Diese Option wird
erst neu bewertet, wenn das Cockpit wirklich unabhaengig ausgeliefert oder
versioniert werden muss.

### Fork des gesamten Clients

Ein kompletter Client-Fork reduziert Zeilenkonflikte im ersten Zug, dupliziert
aber die gesamte Sicherheits-, Transport-, Reconnect- und Kompatibilitaetslogik.
Jedes Upstream-Feature muesste danach bewusst in zwei Apps portiert werden.
Das widerspricht dem Ziel, den Yep-Anywhere-Core weiter zu uebernehmen.

### Ausbau von `/-/preview` zur Hauptoberflaeche

Die Vorschau besitzt absichtlich einen reduzierten, experimentellen
Serververtrag. Fuer Joschas Ziel muessten fast alle reichen Interaktionen neu in
Server und Shared eingefuehrt werden, obwohl sie im vollen Client bereits
existieren. Das erzeugte einen zweiten Anwendungs-Core. Die Vorschau bleibt ein
separates Experiment und kann spaeter Ideen oder kleine reine Komponenten
liefern.

### Micro-Frontends oder iframe

Getrennte Laufzeiten, Kommunikation und Fokus-/Keyboard-Grenzen loesen hier
kein vorhandenes Problem, erhoehen aber Bundle-, Test- und Debug-Aufwand.
Verworfen.

## Erweiterungspunkte

Die Cockpit-Ports werden nach Bedarf und paketweise eingefuehrt. Geplante
Grenzen sind:

- **Navigation und Katalog:** Projekte, Sitzungszusammenfassungen, Pins,
  source-gebundene Suche und Status.
- **Session Detail:** kanonischer Session-Detail-Store, Pagination, Live- und
  Reconnect-Zustand; kein zweiter Transcript-Cache.
- **Composer:** Prompt, Attachments, Queue, Steer und Interrupt als explizite
  Aktionen. Lokale Texteingabe bestaetigt jeden Tastenanschlag unabhaengig von
  Suche, Navigation und Streaming innerhalb von 100 ms.
- **Approvals und Fragen:** bestehende serverautoritative Requests, im Cockpit
  nur als neues View-Modell praesentiert.
- **Werkzeuge, Dateien und Diffs:** bestehende Renderer oder reine
  Datenadapter; Cockpit-eigene Chrome und Aufklappzustand.
- **Vorlesen:** `readAloud.ts` und die vorhandenen `/api/tts`-Routen; keine
  zweite Audio- oder TTS-Implementierung.
- **Darstellung:** Cockpit-eigene semantische Tokens unter einer lokalen
  Root-Klasse, Light/Dark und Akzentwahl. Neue Styles sind CSS Modules; die
  eingefrorenen globalen Styles wachsen nicht.

Ein neuer Server-/Shared-Erweiterungspunkt braucht jeweils:

1. einen providerneutralen Anwendungsfall, den vorhandene Vertraege nicht
   abdecken,
2. Capability- und Fallback-Verhalten fuer aeltere Server,
3. Tests fuer direkten und Relay-Transport und
4. einen Eintrag hier sowie im betroffenen Arbeitspaket.

## Invarianten fuer alle Pakete

- Die bisherige UI bleibt erreichbar, bis Joscha ihre Entfernung ausdruecklich
  beauftragt.
- Kein Cockpit-Code greift direkt auf Provider-Prozesse oder Provider-native
  IDs zu.
- Source-Identitaet bleibt an jeder zustandsbehafteten Grenze explizit.
- Session-Detail-Daten werden nicht in einem zweiten Cockpit-Store gespiegelt.
- Streaming-Token werden nicht in breit abonnierte React-Zustaende verschoben.
- Queue, Steer, Interrupt und Approvals bestaetigt der Server; optimistische UI
  darf die Autoritaet nicht vortaeuschen.
- Neue sichtbare Texte laufen ueber das vorhandene i18n-System. Cockpit-Texte
  werden fuer Joschas deutsche Oberflaeche im selben Paket in `en.json` und
  `de.json` gepflegt; andere sparse Locales fallen bis zu ihrem normalen
  Uebersetzungslauf auf Englisch zurueck.
- Desktop und 375-Pixel-Mobilbreite sind pro sichtbarem Paket zu pruefen.
- Die Schranke und CSS-/i18n-/Console-Pruefungen werden nicht abgeschwaecht.

## Wann die Paketgrenze neu bewertet wird

Ein eigenes `packages/cockpit` wird erst dann sinnvoll, wenn mindestens einer
dieser Ausloeser eintritt:

- Cockpit und Bestandsclient brauchen getrennte Release-Zyklen oder Bundles.
- Mehrere Clients sollen dieselbe Cockpit-Anwendungslogik ohne React teilen.
- Die Adaptergrenze kann ohne Rueckimporte als kleine oeffentliche Bibliothek
  beschrieben werden.
- Messungen zeigen, dass Route-Level-Code-Splitting den alten Client nicht
  ausreichend vom Cockpit-Bundle trennt.

Bis dahin ist das Feature-Verzeichnis die kleinere und merge-freundlichere
Grenze.
