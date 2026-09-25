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

### Suchgrenze aus Paket 4

Die Cockpit-Suche montiert die vorhandene All-Sessions-Akquisition nur solange
ihre eigene Ansicht geoeffnet ist. `useGlobalSessionsFeed` und der
source-gebundene Summary Store liefern den Katalog; `useContentSearch`,
`titleMatches` und die bestehenden Provider-/Server-Capabilities bleiben die
einzigen Besitzer von Titel- und begrenzter Inhaltssuche. Das Cockpit baut
weder einen Transcript-Cache noch einen Datei- oder Transcript-Scanner auf.

Der Eingabe-Draft gehoert unmittelbar der Suchansicht. Die weitergereichte
Suchprojektion laeuft als nicht dringende React-Aktualisierung, sodass Katalog-
und Treffer-Updates den sichtbaren Text nicht ersetzen. Ein source- und
needle-gebundener Entdeckungsrang haelt bestehende Sitzungsgruppen stabil;
spaetere Katalogseiten und Live-Treffer werden angehaengt. Eine ausgewaehlte
Gruppe bleibt ausgewaehlt, solange sie noch passt.

Die Tastaturauswahl folgt derselben stabilen Ergebnisreihenfolge. Pfeil runter
bewegt den Fokus aus dem Suchfeld auf die ausgewaehlte Gruppe, Pfeil hoch und
runter wechseln zwischen benachbarten Gruppen, und Pfeil hoch auf der ersten
Gruppe kehrt zum Suchfeld zurueck. Im Suchfeld selbst bleibt Pfeil hoch nativ.
Enter bleibt die native Link-Aktion; die Suche baut dafuer keine zweite
Navigationslogik.

Abdeckung ist Teil des View-Modells: laufende Katalogseiten, noch unbekannte
oder fehlende Server-Capability, title-only Provider, begrenzte/fehlerhafte
Transcript-Abdeckung und Katalogfehler bleiben sichtbar. Titel-only Suche
startet keine Inhaltsanfrage. Das bestehende offene Index-Gap und die
CI-Nachgeschichte werden dadurch nicht umgangen oder als geloest bezeichnet.

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
zurueckbleibt. Der vorhandene `TextBlock`-Knopf nutzt denselben Controller und
bleibt dadurch kompatibel.

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

### Organisationsgrenze aus Paket 9

Favoriten bleiben vorhandene serverseitige Session-Metadaten. Das Cockpit
schreibt `starred` ueber den source-gebundenen Transport auf die bestehende
Metadatenroute und meldet den bestaetigten Wert danach an denselben Summary-
Store, aus dem Katalog und Suche lesen. Bis zur Serverbestaetigung bleibt die
sichtbare Markierung unveraendert. Lehnt ein aelterer Server die Operation ab,
zeigt das Cockpit einen Rueckfallhinweis und behauptet keinen Erfolg.

Gespeicherte Cockpit-Ansichten sind ein versionierter browserlokaler Record.
Jede Source besitzt eine eigene Liste aus Suchtext und Favoritenfilter; gleiche
Session-IDs verschiedener Hosts teilen dadurch weder Auswahl noch lokale
Organisation. Beim Entfernen eines gespeicherten Hosts werden dessen Ansichten
und Prompt-Verlauf mit entfernt, waehrend andere Sources erhalten bleiben.

Der bereits in Paket 7 angelegte Prompt-Verlauf ist nun Version 2. Alte
Version-1-Eintraege werden beim Lesen mit einem Nutzungszaehler migriert;
unbekannte Versionen fallen leer und ohne Auswirkung auf den Composer zurueck.
Erfolgreich gesendete Prompts werden source-gebunden, dedupliziert und begrenzt
gespeichert. Die UI kann letzte und haeufige Prompts nur in den Draft
uebernehmen; sie sendet nie durch Auswahl eines Verlaufswerts.

Der Prompt-Verlauf ist eine lokale, nicht-modale Dialoggrenze ueber dem
Composer. Escape wird dort abgefangen, schliesst nur den Verlauf und stellt den
Fokus am Ausloeser wieder her. Solange der nicht-modale Dialog offen ist, gilt
diese Escape-Grenze dokumentweit auch nach einem Fokuswechsel aus dem Panel;
die Taste darf in diesem Zustand nicht den globalen Stop-Shortcut erreichen.
Ein Pointer-Klick ausserhalb schliesst den Verlauf, laesst den Fokus aber beim
bewusst angeklickten Ziel.

Die Verlaufssuche ist reiner lokaler Ansichtsstatus. Sie filtert die bereits
geladenen, source-gebundenen Eintraege unmittelbar und startet weder Storage-
noch Netzarbeit pro Tastenanschlag. Beim Oeffnen erhaelt das Suchfeld den Fokus;
Pfeil runter wechselt zum ersten sichtbaren Verlaufseintrag. Innerhalb der
gefilterten Liste bewegen Pfeil hoch und runter den Fokus zeilenweise; Pfeil
hoch auf dem ersten Eintrag kehrt zum Filter zurueck. Auswahl, Entfernung und
Escape behalten die bestehenden Dialoggrenzen.

### Shortcut- und Mobilgrenze aus Paket 10

Die Cockpit-Shell besitzt genau einen dokumentierten Keyboard-Dispatcher. Er
verwendet nur browserneutrale Einzeltasten ausserhalb editierbarer Felder:
`/` oeffnet die globale Suche, `N` die neue Sitzung, `R` fokussiert den
Composer, `G S` und `G P` navigieren zu Sitzungen beziehungsweise Projekten,
und `?` oeffnet die sichtbare Uebersicht. Browserbefehle mit Strg, Befehl oder
Alt bleiben unangetastet. Im Composer ist nur die ausdrueckliche
`Strg/Befehl+Eingabe`-Aktion fuer Queue zusaetzlich aktiv; normale Eingabe und
IME-Komposition bleiben lokale Editorereignisse.

Die sichtbare Uebersicht ist eine modale Fokusgrenze: Sie nimmt den Fokus beim
Oeffnen, haelt Tab-Navigation im Dialog und gibt den Fokus nach Escape,
Schliessen oder Hintergrundklick an ihren Ausloeser zurueck. Bei einem
Tastaturaufruf ist das konkret das zuvor fokussierte Cockpit-Element; wurde es
inzwischen entfernt, dient der sichtbare Navigationsknopf als Rueckfall. Die
globale Suche verwendet dieselbe Regel. Die verdeckte Cockpit-Oberflaeche
bleibt dadurch nicht versehentlich per Tastatur bedienbar. Navigation und
Arbeitsbereich tragen waehrenddessen die native `inert`-Grenze; sie sind damit
auch fuer assistive Technik und programmatischen Fokus nicht erreichbar. Die
Grenze wird vor der Fokus-Rueckgabe entfernt.

Eine bewusste Navigation aus der globalen Suche beendet diese Rueckgabe. Der
Markenlink und die Navigationsziele schliessen die Suche, verwerfen den
gespeicherten Fokusursprung und lassen den Fokus auf dem aktivierten Ziel,
solange es beim Routenwechsel erhalten bleibt. Das Markensignet ist fuer
assistive Technik dekorativ; der Linkname besteht nur aus „Cockpit Yep
Anywhere“.

`Escape` adressiert den serverautoritativen Stop-Knopf aus Paket 8 ueber dessen
semantischen `aria-keyshortcuts`- beziehungsweise Cockpit-Datenvertrag. Die
Shortcut-Schicht fuehrt selbst keinen Interrupt aus und baut daher weder
Pending-/Fehlerzustand noch Provider-Fallback ein zweites Mal nach. Ohne eine
aktive, bedienbare Stop-Aktion wird `Escape` nicht konsumiert.

Auf schmalen Viewports besitzt die Cockpit-Wurzel die sichtbare
`VisualViewport`-Geometrie. Resize- und Pan-Aenderungen durch Browserleiste oder
Bildschirmtastatur aktualisieren nur Hoehe und oberen Versatz der Shell; der
untere Navigationsrahmen und der Composer bleiben innerhalb dieser Wurzel,
waehrend Transcript, Katalog und Suche ihre jeweils eigenen Scrollbereiche
behalten. Mobile Cockpit-Overlays werden ebenfalls innerhalb dieser gemessenen
Wurzel positioniert: Die Shortcut-Hilfe deckt nur den sichtbaren Ausschnitt ab,
und der Prompt-Verlauf oeffnet sich vom Composer aus nach oben, statt sich am
durch die Bildschirmtastatur verdeckten Layout-Viewport auszurichten. Fehlt die
API, bleibt `100dvh` der reine CSS-Fallback. Safe-Area-Insets werden weiterhin
genau an Navigation und Composer angewendet.

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
