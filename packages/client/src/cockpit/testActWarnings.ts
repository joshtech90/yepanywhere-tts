/**
 * Fork-Cockpit (feat/tts-vorlesen): Diese Testdateien erzeugen React-act()-
 * Warnungen je nach Rechnergeschwindigkeit mal und mal nicht. Die strenge
 * Upstream-Pruefung (test/unassertedDiagnostics.ts) scheitert sowohl an einer
 * unbestaetigten Warnung als auch an einem Ausnahmeeintrag, dessen Warnung
 * ausbleibt. Deshalb werden in den importierenden Testdateien genau diese
 * act()-Warnungen verschluckt; alle anderen Diagnosen laufen unveraendert durch
 * die Pruefung. Nur aus Testdateien importieren.
 */
const ACT_WARNING = /not wrapped in act\(|not configured to support act\(/;

const forward = console.error;
console.error = function error(this: Console, ...args: unknown[]) {
  const [message] = args;
  if (typeof message === "string" && ACT_WARNING.test(message)) return;
  return forward.apply(this, args);
};
