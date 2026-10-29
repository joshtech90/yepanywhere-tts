// "Im Terminal öffnen" aus dem Blitz-Menü: Die Webseite schickt nur Anbieter,
// Projektordner und Sitzungs-ID, nie einen fertigen Befehl. Den Befehl baut
// die App selbst aus geprüften Teilen, damit eine Webseite (auch die des
// anderen Rechners) keine beliebigen Befehle auf dem Mac starten kann.

import Foundation

func shellZitat(_ wert: String) -> String {
    "'" + wert.replacingOccurrences(of: "'", with: "'\\''") + "'"
}

/// Inhalt einer .command-Datei, die die Sitzung im Terminal fortsetzt, oder
/// nil bei ungültigen Angaben. Mit `ssh` läuft der Befehl auf jenem Rechner.
func terminalSkript(anbieter: String, ordner: String, sitzung: String, ssh: String?) -> String? {
    guard ordner.hasPrefix("/"), !ordner.contains("\n"), !ordner.contains("\0"),
          // Erstes Zeichen kein "-", sonst waere die ID eine Programm-Option
          // wie --dangerously-bypass-approvals-and-sandbox.
          let erstes = sitzung.unicodeScalars.first, CharacterSet.alphanumerics.contains(erstes),
          sitzung.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" }),
          sitzung.allSatisfy(\.isASCII)
    else { return nil }
    let programm: String
    switch anbieter {
    case "codex": programm = "codex resume \(sitzung)"
    case "claude": programm = "claude --resume \(sitzung)"
    default: return nil
    }
    let befehl = "cd \(shellZitat(ordner)) && \(programm)"
    if let ssh {
        guard ssh.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil else { return nil }
        // Interaktive Shell drüben, damit CODEX_HOME und PATH aus der .bashrc gelten.
        return "#!/bin/zsh\nexec ssh -t \(ssh) \(shellZitat("bash -ic \(shellZitat(befehl))"))\n"
    }
    // Interaktive Login-Shell, damit PATH und CODEX_HOME aus .zshrc gelten.
    return "#!/bin/zsh\nexec /bin/zsh -lic \(shellZitat(befehl))\n"
}
