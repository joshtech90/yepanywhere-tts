// Prueft terminalSkript ohne App: packages/mac-cockpit/test.sh
import Foundation

var fehler = 0
func pruefe(_ name: String, _ ist: String?, _ erwartet: String?) {
    if ist == erwartet { print("ok    \(name)") } else { print("FEHLER \(name): \(ist ?? "nil") statt \(erwartet ?? "nil")"); fehler += 1 }
}

pruefe("Claude auf dem Mac",
       terminalSkript(anbieter: "claude", ordner: "/Users/j/Projects/yep", sitzung: "abc-123", ssh: nil),
       "#!/bin/zsh\nexec /bin/zsh -lic 'cd '\\''/Users/j/Projects/yep'\\'' && claude --resume abc-123'\n")
pruefe("Codex auf aihub per SSH",
       terminalSkript(anbieter: "codex", ordner: "/home/l/AI Worker", sitzung: "01a1-ff", ssh: "dienste"),
       "#!/bin/zsh\nexec ssh -t dienste 'bash -ic '\\''cd '\\''\\'\\'''\\''/home/l/AI Worker'\\''\\'\\'''\\'' && codex resume 01a1-ff'\\'''\n")
pruefe("Fremder Anbieter", terminalSkript(anbieter: "gemini", ordner: "/x", sitzung: "a", ssh: nil), nil)
pruefe("Sitzung mit Befehl", terminalSkript(anbieter: "claude", ordner: "/x", sitzung: "a;rm", ssh: nil), nil)
pruefe("Sitzung als Option", terminalSkript(anbieter: "codex", ordner: "/x", sitzung: "--dangerously-bypass-approvals-and-sandbox", ssh: nil), nil)
pruefe("Relativer Ordner", terminalSkript(anbieter: "claude", ordner: "x", sitzung: "a", ssh: nil), nil)
pruefe("Ordner mit Zeilenumbruch", terminalSkript(anbieter: "claude", ordner: "/x\nrm", sitzung: "a", ssh: nil), nil)
pruefe("SSH-Ziel mit Option", terminalSkript(anbieter: "claude", ordner: "/x", sitzung: "a", ssh: "-oProxyCommand=x"), nil)
exit(fehler == 0 ? 0 : 1)
