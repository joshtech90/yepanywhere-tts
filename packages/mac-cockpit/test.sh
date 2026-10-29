#!/bin/zsh
# Testet Melde-Logik und Terminal-Befehl der Mac-App ohne Fenster.
set -euo pipefail
HIER=${0:A:h}
AUS=$(mktemp -d)
cp "$HIER/Tests/MeldungenTest.swift" "$AUS/main.swift"
swiftc -swift-version 5 -o "$AUS/test" "$HIER/Sources/Meldungen.swift" "$AUS/main.swift"
"$AUS/test"
mkdir "$AUS/terminal"
cp "$HIER/Tests/TerminalTest.swift" "$AUS/terminal/main.swift"
swiftc -swift-version 5 -o "$AUS/terminal/test" "$HIER/Sources/Terminal.swift" "$AUS/terminal/main.swift"
"$AUS/terminal/test"
rm -rf "$AUS"
