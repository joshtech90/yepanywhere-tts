# Auftrag: yepanywhere auf upstream bringen (Joscha, 30.09.2026)

Joscha hat im Technik-Wache-Bogen entschieden: Merge von Hand in eigener
Sitzung, mit Sol-Pruefung. Wichtig laut Joscha: **sein Cockpit muss
vollstaendig erhalten bleiben** (dazu Vorlesen/TTS und Auto-Sitzungstitel).

## Befund 30.09.2026
- Arbeitszweig `feat/tts-vorlesen` (GitHub joshtech90/yepanywhere-tts), synchron
  mit origin. Gegenueber `upstream/main` (kzahel/yepanywhere): 94 eigene,
  159 fehlende Commits.
- Der automatische Versuch am 28.09. scheiterte (Gemini und Claude), Stand
  wurde zurueckgerollt, Sicherung `vor-upstream-2026-09-28-093008`.
- `git merge-tree` zeigt 7 Konflikte:
  packages/client/src/i18n/en.json, packages/server/src/app.ts,
  packages/server/src/auth/AuthService.ts, packages/server/src/auth/routes.ts,
  packages/server/src/routes/settings.ts, pnpm-lock.yaml,
  scripts/css-architecture-baseline.json
- Auth-Konflikte sind sicherheitskritisch: Nur Tailnet, kein Funnel, keine
  Aufweichung der Anmeldung.

## Vorgehen
1. Memory lesen: `.memory/MEMORY.md`, Memory-Eintraege zu yep-Cockpit
   (ein Stand Mac+aihub), TTS-Update-Workflow, Auto-Sitzungstitel;
   `docs/cockpit/ARCHITEKTUR.md`; `AI Worker/docs/knowledge/updates.md`.
2. Merge auf eigenem Zweig (z. B. `merge/upstream-2026-09-30`), Konflikte
   einzeln aufloesen, Upstream-Neuerungen uebernehmen, eigene Features erhalten.
3. Build, Cockpit-Tests, Server-Tests (Suiten einzeln, `pnpm test` bricht bei
   push-broker ab), CSS-Baseline.
4. Read-only Review mit GPT-6.1 Sol (high) ueber den fertigen Diff, besonders
   Auth. Findings abarbeiten.
5. Erst dann auf `feat/tts-vorlesen` uebernehmen, pushen und ueber
   `AI Worker/scripts/yep_nachbau.py` auf Mac und aihub ausrollen. Danach im
   echten Cockpit (Seitenleiste, Neue Sitzung, Vorlesen, Rechnerwechsel)
   pruefen. Bei Problemen auf die Sicherung zurueck.
6. Ergebnis kurz fuer Joscha zusammenfassen (Practical-Stil, Next step,
   Orchestrierungszeile).

## Erledigt 30.09.2026 (Claude Opus 5.5)
- `fcedfd424` auf `feat/tts-vorlesen` (Merge `1db90279e` + 3 Folge-Commits),
  Sicherung `vor-upstream-2026-09-30-manuell`. Mac und aihub laufen darauf.
- Gepruefte Punkte, offene Reste und Merge-Fallen: Memory
  `project_yepanywhere_tts_update_workflow` (Eintrag 2026-09-30).
- Offen: Sichtpruefung im eingeloggten Cockpit durch Joscha (der KI-Browser
  hat kein Yep-Passwort).
