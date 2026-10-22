# Project service — sketches

Designs that are not current guidance. [[project-service]] owns the current
declaration and lifecycle contract. Dates are when an option was weighed,
not when it might be revisited.

## File-link resolver protocol (October 21, 2026)

Static `fileLinks.pathTemplate` covers repository browsers without querying an
app. Apps whose routes depend on an index could instead opt into a resolver
endpoint accepting a project-relative path and fragment and returning an
app-relative route or an explicit unsupported result. YA still supplies
the existing public vhost and matching token outside that response.

No declaration means no discovery, probe, or startup. A declared resolver may
start a stopped app only with a further explicit `startOnRequest` opt-in, on a
user action and under existing lifecycle authority and loop guards. Rendering
session autolinks must never trigger it. Requests need bounded time and size,
broker confinement, and no redirect-following. This remains unimplemented;
the static template needs no resolver round trip.

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
