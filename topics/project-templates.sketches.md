# Project templates — sketches

Candidate stacks and reach paths considered for the shipped template set
and set aside. The decision they informed is in
[[project-templates]] § Stack decision; this file keeps the reasoning so a
rejected option is not re-argued from scratch. Dates are when the option was
weighed, not when it might be revisited.

## Stacks considered for the kid-facing canvas template (2026-09-20)

The envelope: 2D/3D drawing, microphone input, iterate from a tablet with
the YA App pane as the primary testing surface, agent-primary editing, and
eventual iOS/Android packaging. Under that envelope every candidate reduces
to "what does its web target look like inside an iframe", and the deciding
axes are how well an agent reads, writes, and verifies the project from text
and how well the result runs in the pane.

- **Vite + TypeScript + Capacitor.** Same base as the chosen template;
  Capacitor wraps the bundle for iOS/Android, with Xcode/Android Studio only
  at packaging. Set aside as *base tree* content because the pane never
  exercises it and a PWA manifest already gives "Add to Home Screen" on iPad.
  Kept as the `mobile-shell` element. iOS WebView audio input needs a user
  gesture and has had permission quirks across Safari versions; verify on the
  actual iPad when the element is first used.
- **Godot 4 (GDScript).** Most opinionated and best for a kid who will open
  an editor: scene tree, physics, tilemaps, particles, audio, input mapping;
  exports to web (wasm), iOS, Android. Mic is `AudioStreamMicrophone` with
  `AudioEffectCapture` and `audio/driver/enable_input` on; C#/.NET still
  cannot export to web. Rejected for v1 because the editor is its whole
  advantage and the pane shows only the export: a 30–40 MB wasm bundle with
  multi-second reload, whose default threaded build needs `SharedArrayBuffer`
  (COOP/COEP, which the artifact path does not send), and whose
  thread-support-off export is its least-tested mode inside a
  `worker-src 'none'` CSP. GDScript also has far thinner agent coverage than
  TypeScript, and headless export needs version-matched export templates.
  Survives only as a possible later template on the vhost path for an
  explicit engine-learning goal.
- **nanovg (zig or JS build, over wasm/WebGL).** Vector antialiased 2D with
  a canvas-like API, portable to non-browser targets. In the pane it
  re-implements Canvas2D, which the browser already accelerates, at the cost
  of a Zig or Emscripten toolchain, a glue layer, font loading into the wasm
  heap, and a thin corpus for the agent. Its real win, one 2D API in browser
  and native, is not a stated goal; if it becomes one, Canvas2D in the browser
  plus a Skia binding natively is the pragmatic form. Kept as the optional
  `graphics` element and expected to go unused.
- **Expo (React Native) and Flutter.** UI-widget frameworks whose canvas
  story is a bolt-on (`@shopify/react-native-skia`, `CustomPainter`) and
  whose web targets are their least polished part. In a pane-only loop an
  emulator cannot render into the browser, so they reduce to those web
  builds. Rejected.
- **p5.js (`sketch.js`).** Designed for beginners (`setup`/`draw`), good for
  the first afternoon, but untyped and global-namespace, and slow past a few
  hundred objects. Its TypeScript-friendly instance mode fits inside the
  Vite base as a library if wanted; not a template of its own.

## Reach paths from a tablet over relay (2026-09-20)

The encrypted relay carries YA protocol only; pane content travels directly
from the browser to the artifact origin
([[active-content-security]] § Configuration and delivery). Options weighed:

- **Public wildcard tunnel to the artifact listener** — chosen; see the main
  topic. One wildcard DNS record and one ingress rule on the existing
  `cloudflared` tunnel; no client software; vhosts stay behind the app-scoped
  bearer.
- **Tailscale/WireGuard on the tablet.** Persistent and not killed by
  Android, but it works best by skipping the relay: open the local client at
  the tailnet address. The https hosted client cannot iframe an http tailnet
  origin (mixed content), and `tailscale serve` gives one TLS hostname
  without wildcard subdomains, so vhost-by-label does not fit. A fine
  operator path, not a kid's default.
- **SSH tunnel from the tablet** (Termux, ConnectBot, JuiceSSH). Forwarding
  YA's port alone covers client, artifacts, and `name.localhost` vhosts, since
  those are dispatched on the same port. Unverified beliefs: Android Chrome
  resolves `*.localhost` to loopback without DNS, and exempts `localhost`
  origins from mixed-content blocking so the hosted client can iframe them.
  Samsung's background-process killing makes it a tinkering path.
- **Emulators.** Not needed by any candidate; everything tested is a web
  target in the pane. An emulator enters only at Capacitor packaging time on
  a desktop, outside this loop.
