# Cockpit-Architektur

Stand: 24. September 2026

Ausgangsbasis der Cockpit-Serie:
`034026b9da89e60e09e2de2f034075b3e9f2eadc`

Basis dieses Umsetzungsschritts:
`e72dc8e2a2c81c4cbf678c8472a28f80f6637221`

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

- `ready` zeigt den leeren, fuer Paket 3 vorbereiteten Arbeitsbereich;
- `connecting` und `reconnecting` zeigen Laden bei stabiler Geometrie;
- `disconnected` zeigt Offline;
- ein von einem Transportkanal gemeldeter Fehler zeigt den Fehlerzustand.

Damit entstehen keine zweite Verbindungslogik und kein zweiter Store. Desktop
verwendet eine feste Sidebar; bis 700 Pixel wird dieselbe Navigation zu einer
Safe-Area-faehigen unteren Leiste. Fokus, Touch-Ziele und Reduced Motion werden
innerhalb derselben Feature-Grenze gepflegt.

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
- Neue sichtbare Texte laufen ueber das vorhandene i18n-System. Der
  Repository-Workflow nimmt neue Schluessel zuerst in Englisch auf; die
  deutsche Oberflaeche verwendet vorhandene deutsche Schluessel sofort und
  erhaelt neue Uebersetzungen im normalen Uebersetzungslauf.
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
