// Melde-Logik ohne AppKit, damit test.sh sie allein pruefen kann.

import Foundation

struct Prozess: Decodable {
    let sessionId: String
    let projectId: String
    let projectName: String?
    let sessionTitle: String?
    let state: String
    let startedAt: String?
    let idleSince: String?
}

struct ProzessListe: Decodable {
    let processes: [Prozess]
}

private let isoZeit: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

/// Entscheidet aus zwei Abfragen, ob ein Auftrag fertig wurde oder wartet.
/// Rein und ohne Uhrvergleich zwischen den Rechnern, damit testbar.
func meldungen(vorher: [String: Prozess], jetzt: [Prozess]) -> [(Prozess, String)] {
    var ergebnis: [(Prozess, String)] = []
    for prozess in jetzt {
        let alt = vorher[prozess.sessionId]
        switch prozess.state {
        case "idle":
            if let alt {
                // Wie upstream (PushNotifier): Warten auf Joscha zaehlt zur Arbeit.
                // Ein neuer idleSince-Wert heisst, dass dazwischen ein ganzer
                // Durchgang lief, auch wenn er kuerzer als eine Abfrage war.
                if alt.state == "in-turn" || alt.state == "waiting-input"
                    || (alt.state == "idle" && alt.idleSince != prozess.idleSince && prozess.idleSince != nil) {
                    ergebnis.append((prozess, "fertig"))
                }
            } else if let start = prozess.startedAt.flatMap(isoZeit.date(from:)),
                      let ende = prozess.idleSince.flatMap(isoZeit.date(from:)),
                      ende.timeIntervalSince(start) > 2 {
                // Neuer Prozess, der schon vor der Abfrage fertig war.
                ergebnis.append((prozess, "fertig"))
            }
        case "waiting-input":
            if alt?.state != "waiting-input" { ergebnis.append((prozess, "wartet")) }
        default:
            break
        }
    }
    return ergebnis
}
