# Project service — sketches

Designs that are not current guidance. [[project-service]] owns the current
declaration and lifecycle contract. Dates are when an option was weighed,
not when it might be revisited.

## Reload signal without restart (October 15, 2026)

Settings offers **Restart app** for a running process app: YA stops the owned
process group under the declared `stop` and starts it again in the same mode,
so the app rereads start-time configuration. That costs the app's startup
time and drops in-flight requests.

Many servers reread configuration on `SIGHUP` instead. An optional declaration
section would let a template say so:

```json
{
  "service": {
    "version": 1,
    "reload": { "signal": "SIGHUP" }
  }
}
```

- Process only; the only accepted signal is `SIGHUP`, sent to the owned
  process group, like `stop`. No arbitrary signal or command.
- When present, Settings shows **Reload config** beside Restart; absent, only
  Restart. YA does not probe whether the app handles the signal, since an
  unhandled `SIGHUP` terminates most processes; the declaration is the
  app's promise.
- After the signal YA reruns the declared `status` probe and reports ready or
  failed, as after start.
- Needs a server capability so older servers keep showing only Restart, and
  a declaration-version decision: an unknown section is rejected today
  (§ Standard declaration), so either bump `version` or admit `reload` as an
  optional `version: 1` field gated by that capability.
