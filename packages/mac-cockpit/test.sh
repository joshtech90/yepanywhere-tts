#!/bin/zsh
# Testet die Melde-Logik der Mac-App ohne Fenster.
set -euo pipefail
HIER=${0:A:h}
AUS=$(mktemp -d)
cp "$HIER/Tests/MeldungenTest.swift" "$AUS/main.swift"
swiftc -swift-version 5 -o "$AUS/test" "$HIER/Sources/Meldungen.swift" "$AUS/main.swift"
"$AUS/test"
rm -rf "$AUS"
