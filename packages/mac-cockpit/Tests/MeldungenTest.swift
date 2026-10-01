// Prueft meldungen(vorher:jetzt:) ohne App: packages/mac-cockpit/test.sh
import Foundation

var fehler = 0
func p(_ id: String, _ state: String, start: String = "2026-10-01T08:00:00.000Z",
       idle: String? = nil) -> Prozess {
    Prozess(sessionId: id, projectId: "proj", projectName: "Projekt", sessionTitle: "Titel",
            state: state, startedAt: start, idleSince: idle)
}
func pruefe(_ name: String, _ vorher: [Prozess], _ jetzt: [Prozess], _ erwartet: [String]) {
    let alt = Dictionary(uniqueKeysWithValues: vorher.map { ($0.sessionId, $0) })
    let ist = meldungen(vorher: alt, jetzt: jetzt).map { "\($0.0.sessionId):\($0.1)" }
    if ist == erwartet { print("ok    \(name)") } else { print("FEHLER \(name): \(ist) statt \(erwartet)"); fehler += 1 }
}

let i1 = "2026-10-01T08:00:05.000Z", i2 = "2026-10-01T08:01:00.000Z"
pruefe("Durchgang endet", [p("a", "in-turn")], [p("a", "idle", idle: i1)], ["a:fertig"])
pruefe("Nach Rueckfrage fertig", [p("a", "waiting-input")], [p("a", "idle", idle: i1)], ["a:fertig"])
pruefe("Kurzer Durchgang zwischen zwei Abfragen", [p("a", "idle", idle: i1)], [p("a", "idle", idle: i2)], ["a:fertig"])
pruefe("Ruhig bleibt ruhig", [p("a", "idle", idle: i1)], [p("a", "idle", idle: i1)], [])
pruefe("Arbeitet weiter", [p("a", "in-turn")], [p("a", "in-turn")], [])
pruefe("Faengt an zu warten", [p("a", "in-turn")], [p("a", "waiting-input")], ["a:wartet"])
pruefe("Wartet weiter, keine Wiederholung", [p("a", "waiting-input")], [p("a", "waiting-input")], [])
pruefe("Neuer Prozess wartet sofort", [], [p("b", "waiting-input")], ["b:wartet"])
pruefe("Neuer Prozess schon fertig", [], [p("b", "idle", idle: "2026-10-01T08:00:30.000Z")], ["b:fertig"])
pruefe("Neuer Prozess nur geoeffnet", [], [p("b", "idle", idle: "2026-10-01T08:00:00.500Z")], [])
pruefe("Neuer Prozess arbeitet", [], [p("b", "in-turn")], [])
pruefe("Prozess verschwunden", [p("a", "in-turn")], [], [])
exit(fehler == 0 ? 0 : 1)
