# Gateway Services

> A gateway service is one configured model-serving endpoint: an OpenAI- or
> Anthropic-compatible HTTP server, optionally one YA may start and stop, with
> stated context and output sizes and its own harness narrowings. Claude Gateway
> and CodexOSS both launch against these entries.

Topic: gateway-services

Related topics: [claude](claude.md), [provider-abstraction](provider-abstraction.md),
[server-capabilities](server-capabilities.md), [ya-env-vars](ya-env-vars.md),
[backward-compat](backward-compat.md).

See also: [Codex OSS](../docs/codex-oss.md) for the Codex CLI side of local
model serving.

## Contract

### Configuration

- `settings.gatewayServices` is a list of entries; `settings.defaultGatewayServiceId`
  names the one Claude Gateway treats as default. An entry states an `id`
  (lowercase slug, stable, referenced by qualified model ids), a `url`, and
  optionally a `label`, a compact `shortName` for showing where a model runs, a
  `serviceCommand`, `autoStop` with `autoStopAfterSeconds`, `contextWindowTokens`
  and `maxOutputTokens`, `maxModels`, `effortLevels` with `defaultEffortLevel`,
  `disableAgent` / `disablePlanMode` overrides, `codexEnabled`, and
  `codexWireApi`.
- `codexWireApi` defaults to `responses`. Current Codex refuses to load a
  provider that says `chat` ("`wire_api = \"chat\"` is no longer supported",
  codex-cli 0.154.0); the value stays selectable only for an older CLI, and an
  explicit choice is passed through rather than silently upgraded.
- The list and the older single-gateway settings (`claudeGatewayUrl`,
  `claudeGatewayStartCommand`) are two views of one configuration. The default
  entry mirrors those keys in both directions, so a client without the
  `claude-gateway-services` capability keeps editing the gateway actually in
  use. An installation that has never seen the list gets its configured gateway
  migrated into a `default` entry.
- Only a non-empty legacy value overrides the entry it mirrors, except when the
  update explicitly writes the legacy key: clearing `claudeGatewayUrl` from an
  older client removes that one entry rather than resurrecting it. An absent
  legacy value never clears a configured command.
- A malformed list is rejected whole rather than partially applied, so a user
  never silently loses a service they believe is configured.
- A `serviceCommand` is accepted only for a loopback URL. A non-loopback entry
  is an endpoint YA merely talks to: never started, stopped, or signalled.

### Lifecycle

- Loopback classification is the boundary for every lifecycle action: exact
  `localhost` / `localhost.`, IPv4 `127.0.0.0/8`, or IPv6 `::1`. A name that
  merely resolves to loopback does not qualify.
- A bounded TCP probe decides whether a service is running. Any listener
  suppresses launching the command, even when the catalog read then fails.
- A command written as `<script> start` declares itself a service script: the
  trailing verb is stripped and `start`, `status`, and `stop` are used
  throughout. Otherwise YA asks the command what it is — `<command> status`
  exiting cleanly means verbs; a status invocation that keeps running means the
  command is the server itself, which YA then owns as a foreground child and
  terminates by process group; an ambiguous answer tries the start verb once
  and then the bare command.
- Stopping asks the command, then re-probes the port after a delay and signals
  the listener only if it is still there. A service that defers shutdown until
  its own last client goes idle is not cut short, and a command with no `stop`
  verb still ends up stopped. Signalling uses the shared port-listener control:
  a unique, same-user listener that is never YA or one of its ancestors.
- `autoStop` schedules that stop request once no live session uses the service,
  after the entry's idle delay; any later use cancels it.
- Each service owns its own launcher: reconfiguring or removing one never
  disturbs another's process, and a removed entry's child and pending stop
  check are torn down with it.

### Catalogs and model identity

- Each service's own `/v1/models` is authoritative for that service. Claude
  Gateway returns the union across enabled services and never merges Claude's
  built-in aliases or borrows another service's rows.
- The union follows the configured order of the entries, and so does the model
  picker; both providers order it the same way for the same services. That
  order is the user's to set by moving entries in the services editor. The
  default entry is not hoisted: a read's authority to start a service is
  decided by comparing its id against the default, and the reads run
  concurrently, so position never affected anything but the picker.
- A model id stays exactly as its service advertises it while only one service
  offers it. When two do, both gain a `<serviceId>::<model>` prefix; `/` is
  unusable as a separator because a vLLM server with no `--served-model-name`
  advertises a Hugging Face repo id that already contains one. A launch always
  reaches the owning service under the plain name that service knows.
- A catalog read may start only the default service. A non-default service that
  is not already listening contributes nothing until one of its models is
  selected, and that selection is what authorizes its start.
- A service that could not be read keeps its last good catalog and routes;
  only a successful read publishes a change.
- `maxModels` truncates one service's contribution in catalog order, defaulting
  to 100.

### Declared sizes and backend identity

- Configuration is authoritative for context and output size. An advertised
  value is used only where configuration states none: a copilot-style
  `capabilities.limits` first, then vLLM's top-level `max_model_len`, which is a
  whole window rather than a prompt-only ceiling. A declared output size
  reserves room inside the declared context window for the compaction window.
- Backend identity is observed from the response, never configured: copilot-api
  through its explicit `X-Copilot-API` header, vLLM through `owned_by` on its
  model rows. Model names, ports, vendors, and generic endpoint compatibility
  never imply either. A launch publishes `AGENT_LAUNCH_BACKEND`, and copilot-api
  additionally keeps its legacy `YEP_COPILOT_API=1` marker for out-of-repo
  readers.

### Thinking effort

- An OpenAI-compatible catalog row normally states nothing about reasoning — a
  vLLM row carries an id, an owner and a window — so a model that accepts effort
  is indistinguishable from one that does not. Levels come from the entry's
  `effortLevels` first, then from a row's
  `capabilities.supports.reasoning_effort`, then from the model families YA
  knows, then from what the endpoint answered when asked. A model no source
  describes offers no effort control at all rather than a guessed one.
- One resolution serves both transports. Claude Gateway and CodexOSS reach the
  same endpoint over different wires; a model offering effort through one offers
  it through the other, so both read the same four sources. Only what each wire
  can *say* differs, which is the "none" distinction below. CodexOSS therefore
  advertises the thinking control at the provider level and lets each model
  decide: a model no source describes states `supportsAdaptiveThinking: false`
  and shows none, which is what every Ollama-listed model states.
- A launch cannot re-derive the per-model and per-endpoint sources, which exist
  only in a catalog response. CodexOSS keeps each service-qualified model's
  resolved effort from its last catalog read and places the selected level
  against that, falling back to configuration and the built-in families.

### Asking an endpoint what it accepts

- `settings.gatewayServiceEffortDetection` is a default-on setting: YA sends one
  chat request naming an unrecognized effort, and request validation rejects it
  with the accepted vocabulary spelled out. Observed against vLLM 0.11 serving
  DeepSeek-V4-Flash: `Input should be 'none', 'minimal', 'low', 'medium',
  'high', 'xhigh' or 'max'`. Validation runs before scheduling, so the probe
  costs no inference and no accelerator time.
- The answer describes the *endpoint's request schema*, not the model behind it:
  a vLLM server hosting a model that ignores the field still answers with the
  full vocabulary. That is why a probe answer ranks last, and why the entry's
  own `effortLevels` — which win over everything — remain the correction for an
  endpoint that overclaims.
- An entry stating its own `effortLevels` is never asked: configuration wins for
  every model of that service, so no answer could change the outcome.
- Answers are cached per endpoint URL and shared between the two providers, 30
  minutes for an answer and one minute for a silence, since the usual silence is
  an endpoint that is not up yet. A reconfigured services list drops the cache,
  because the same address may now front a different server.
- A 2xx to the probe means the endpoint validates nothing and has therefore said
  nothing; it is not read as accepting every level.
- `POST /api/settings/gateway-services/effort` asks one endpoint on demand. It
  bypasses both the cache and the setting, and its URL must be loopback or
  already configured: unlike catalog discovery it sends a chat request, so it
  stays pointed at endpoints the server already talks to. The answer is written
  into the draft entry's level checkboxes for review rather than applied
  invisibly.
- The editor presents an entry's two states as a choice between asking the
  endpoint and stating the levels, because that is what they are: an entry
  holding no list defers, and one holding a list decides. Nothing new is
  stored for it. Choosing to state the levels asks the endpoint first and ticks
  the answer, falling back to every level YA names, so the list is never left
  empty — an empty list would mean the opposite of the chosen mode. Choosing to
  ask turns the detection setting on, since leaving it off would make the
  choice mean "use the built-in families only".
- `defaultEffortLevel` states what the endpoint applies to a request naming no
  effort. It is meaningful only alongside `effortLevels` and must be one of
  them; a list stating nothing is no list at all, which restores the advertised
  or built-in levels.
- A selected level is sent, and only a selected level: a turn that states no
  effort leaves the endpoint's own default in place. A level the model does not
  list snaps down to the nearest listed one, never up, so a session carrying an
  effort from another model cannot buy more thinking than was asked for.
- What each transport can say differs. Claude Gateway carries effort as the
  Anthropic `output_config.effort`, whose values are the named levels alone:
  there is no "none", so thinking cannot be turned off over that transport even
  for a model that accepts it. CodexOSS passes Codex's
  `model_reasoning_effort`, which becomes the Responses API `reasoning.effort`
  and does carry "none", so thinking-off is expressible there.
- DeepSeek V4 is the family YA ships knowing. Its chat encoder collapses seven
  request values onto four behaviors — `none` off, `minimal`/`low`/`medium` low,
  `high`/`xhigh` high, `max` max — and thinks at high when a request states
  nothing. Only the levels reaching a distinct behavior are offered (low, high,
  max), so no two menu entries do the same thing.

### Harness narrowings

- `disableAgent` and `disablePlanMode` are per-entry overrides that inherit the
  server-wide settings when unset. They exist because a gateway-served model is
  often weaker at delegation and plan-mode protocol, which is a fact about one
  model server rather than about every gateway at once.

### CodexOSS

- CodexOSS launches against the entries with `codexEnabled`, listing their
  models from `/v1/models` and passing Codex `model_providers.<id>` overrides on
  the command line — base URL and `wire_api` — rather than editing the user's
  `~/.codex/config.toml`. YA never rewrites a CLI's own settings files.
- The services editor checks `codexEnabled` by default on a newly added entry:
  an endpoint added to the list is usually the reason CodexOSS is being turned
  on at all. Existing entries keep whatever was saved, and the single-gateway
  legacy paths still default to off.
- With no such entry configured, CodexOSS keeps its existing behavior exactly:
  `codex exec --oss --local-provider <ollama|lmstudio>`, with models enumerated
  from `ollama list`.

## Compatibility

The `claude-gateway-services` capability gates the client's services editor.
Without it, the client shows the single Claude Gateway URL and start-command
form and writes only the older `claudeGateway*` settings, which the server keeps
mirrored to the default entry.

## Launches never edit the user's provider config

A launch writes nothing. Claude Gateway supplies its transport through the
Claude SDK's per-launch flag-settings layer and the child environment; CodexOSS
passes `-c model_providers.<id>.…` overrides on the command line. A YA session
therefore cannot disturb a concurrently running TUI.

## Terminal export

`settings.gatewayServiceExportEnabled` is an opt-in, default-off setting that
publishes the configured services for the provider CLIs, so the same models are
selectable from a plain terminal session.

- Per enabled service, YA writes `$CLAUDE_CONFIG_DIR/ya-<id>.settings.json`
  carrying the transport environment, and — for a service CodexOSS may use —
  `$CODEX_HOME/ya-<id>.config.toml` carrying a `model_providers` entry. The
  commands are `claude --settings <that file>` and `codex -p ya-<id>`, and the
  settings UI states them verbatim per service.
- The Claude file also carries the window, because a terminal session gets no
  other statement of it: Claude assumes 200K for a model its catalog does not
  know, which would silently truncate a 252K local model. A declared context
  size becomes `CLAUDE_CODE_MAX_CONTEXT_TOKENS` plus the derived compaction
  window; with nothing declared, the file turns the assumption off rather than
  inventing a number.
- Both are YA-owned files distinct from the ones the user edits. `settings.json`
  and `config.toml` are never read, modified, or merged: Claude loads the extra
  file through `--settings`, and Codex layers the profile through `-p`.
- The export re-syncs whenever the services list is known or changes, not only
  when the setting is toggled. Each file is written to a temporary path and
  renamed, since the directory is shared with a tool the user runs.
- Files for services that disappear are removed, and turning the setting off
  removes everything the export wrote. Only files carrying YA's managed marker
  are ever deleted, so a hand-written file that happens to match the naming is
  left alone.
- `GET /api/settings` reports the resolved `gatewayServiceExportPaths` so the
  client can state exact commands; it is server-derived and never accepted from
  a client.

## Known gaps

- vLLM serves `/tokenize` and a native Anthropic `/v1/messages/count_tokens`
  (`input_tokens`, plus a `context_management` block), which would allow exact
  pre-turn token budgeting rather than relying on the harness's own estimate.
  YA reads neither yet.
- Per-service credentials: catalog reads send a literal `Bearer dummy`, so an
  endpoint that needs a real key has nowhere to put one.
