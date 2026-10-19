# Local shared-folder workspace spike

Status: disposable fixture built and physically validated, 2026-10-18.
Production host integration remains pending.
Owning contract: [durable user-owned workspace](../../../topics/android-host.md#durable-user-owned-workspace).

## Scope and stopping condition

A disposable Android app selects a newly created local `Documents` child through
DocumentsUI, separately obtains real all-files access, resolves the built-in
external-storage provider to a verified local path, and maps it into the existing
Alpine/PRoot payload at `/workspace`. Shell, Python, Codex and Claude must read and
write those external bytes directly. No sync cache, private workspace substitute,
general SAF adapter or production host onboarding is introduced.

Keep reusable Android path/grant qualification in Machine Control and the
fixture app, shared YA payload integration and acceptance runner here. All three
reference projects (MC, JSTorrent and Web Server Chrome) declare MIT licenses;
retain notices for any imported source. Existing payload third-party licenses
continue to apply. The implementation is new code informed by their patterns.

## Physical acceptance

1. Discover devices with MC, explicitly select the requested physical test phone,
   run doctor and refuse a wrong, locked or unavailable target.
2. Create an exclusively owned fresh folder. Use the real folder picker and
   separate all-files permission settings. Prove the SAF selection names the
   directory actually exposed to PRoot.
3. Run deterministic shell/Python CRUD, random-write/truncate, rename/replace,
   file/directory fsync, cross-process locks, symlink/mode, Git and SQLite probes.
   Report unsupported operations honestly; keep production live databases private.
4. Run both real provider CLIs with disposable private profiles and temporary
   inference grants. Independently verify bytes and SHA-256 from outside PRoot.
5. Force-stop/restart and verify through fresh handles. Revoke SAF and broad
   authority separately; no empty/private fallback or false success is permitted.
6. Clear only this disposable package's data, then reselect/regrant and verify
   unchanged external hashes. Repeat after uninstall/reinstall. App-local root
   registration may be new; no erased database or hidden project marker is needed.
7. Revoke temporary inference grants, remove only owned transport mappings,
   stop/uninstall the disposable app and remove only the exact owned test tree.
   Preserve a private recovery receipt on failure.

The signed-in YA host, its runtime state, credentials, other applications,
existing user documents, accessibility configuration and debugging listeners are
not modified. Concrete selectors, tokens, runtime binaries and raw evidence stay
under ignored `.local/`. Reset/restart survival does not claim power-loss,
Doze, reboot, cloud-provider or Play-policy acceptance.

## Build and run

Use the host's already prepared, verified `.local/runtime.tar`, native libraries
and license assets. Supply the sibling MC checkout explicitly; the fixture
compiles its reusable `platforms/android/storage/src/main/java` source directly,
without copying it into YA or adding a production host dependency.

```sh
packages/android-host/gradlew -PworkspaceSpike \
  -PmachineControlRoot="$MACHINE_CONTROL_CHECKOUT" \
  :workspace-spike:assembleDebug :workspace-spike:lint

python3 packages/android-host/workspace-spike/live.py \
  --device-file "$PRIVATE_DEVICE_SELECTION_JSON" \
  --machine-control "$MACHINE_CONTROL_CHECKOUT" \
  --aar-checkout "$AAR_CHECKOUT"
```

The private device file contains `serial` from explicit MC/ADB discovery. The
runner creates a private common-CLI registry, runs its doctor, checks the exact
requested phone model, and uses MC install/launch/stop/screenshot operations.
DocumentsUI and the all-files Settings surface receive real consent actions;
no appops shortcut stands in for initial consent. There is no editable text
field or changed production typing path in this fixture.

Real provider inference uses new revocable AAR grants and one exclusively owned
USB reverse. It never reads or copies the signed-in host's OAuth stores. Runtime,
provider homes, logs, expected hashes and grant material stay private. Independent
hash witnesses use the controller's Android shell reader, outside PRoot.

On failure, the app is stopped, inference grants/reverses are cleaned up and a
mode-0600 recovery receipt retains the owned app/tree identity. `--resume` takes
that private run directory, verifies its selection sentinel, replaces only its
fixture APK, and restarts acceptance after clearing only its owned test tree
and disposable private probe profiles. Do not point it at a user workspace.
`--resume ... --recovery-only` instead retains the already-proved bytes, checks
all external hashes against saved provider evidence, and continues the
permission/reset checks without repeating inference. Use it only after both
provider outputs and `hashes.json` were saved. Neither continuation targets a
user workspace. Successful acceptance uninstalls the fixture and removes its
exact owned tree.

## Evidence

### Physical result — Pixel 7a, Android API 37, 2026-10-18

The real DocumentsUI picker selected an exclusively owned `Documents` child.
The separate Android Settings screen granted all-files access. A native SAF
read and raw-path read agreed on a controller-created sentinel before PRoot
started. Guest processes ran under the fixture's ordinary Android app UID and
`untrusted_app` SELinux domain. The mapping was PRoot's
`-b <verified-shared-directory>:/workspace`, with writes going to those external
bytes immediately. There is no newly mounted filesystem.

Both existing real provider CLIs passed with disposable private homes:

| Provider | Actual tool calls | Inference/probe time | Independently checked effect |
| --- | ---: | ---: | --- |
| Codex | 3 | 20.37 s | File-edit tool wrote text; shell/Python wrote a 4,100-byte positional-I/O binary |
| Claude | 5 | 11.98 s | Write tool wrote text; shell/Python wrote the same binary pattern |

The controller read all 28 fixture files outside the app UID/PRoot and compared
SHA-256 inventories. Provider claims were not the correctness oracle. Fresh
process verification reopened the SQLite fixture and checked its contents and
integrity. Acceptance also covered these distinct lifetime/authority cases:

- Force-stop/restart preserved the byte inventory.
- Releasing the persisted SAF grant caused explicit workspace refusal. A
  diagnostic native read deliberately bypassing admission still succeeded with
  all-files enabled. Reselecting the folder repaired admission.
- Disabling actual all-files access caused explicit refusal and denied a fresh
  native raw-path read. Re-enabling repaired access. This does not establish
  immediate invalidation of already-open descriptors or running sessions.
- Clearing **only the disposable app's data** erased its registration/runtime;
  external hashes stayed unchanged. Restaging private binaries and selecting
  the existing folder recovered access without an app database or project marker.
- Uninstall/reinstall repeated the same external-hash and reselection checks.

All-files authority is broader than `/workspace`; neither SAF admission nor
PRoot provides a security boundary against code running under that app UID.

### Measured filesystem semantics

| Operation | Observed result |
| --- | --- |
| Shell CRUD, Python ordinary files | Pass |
| Positional writes, truncate, file fsync | Pass, including sparse/zero-filled bytes verified externally |
| Rename/replace with an open old reader | Pass: old reader retains old bytes; path exposes replacement |
| Directory fsync | Returns success; power-loss durability not tested |
| POSIX `lockf` across processes | Contention enforced |
| `flock` | Fails with ENOSYS (38) |
| Symlink creation | Fails with EACCES (13) |
| `chmod 0755` / direct script execution | Mode reads back 0660; execution fails with EACCES |
| Filename case | Case-insensitive |
| Git | Default object creation fails; local `core.createObject=rename` permits add/commit/checkout/reset/fsck and index-lock refusal |
| Git trust/metadata | Explicit trust for the owned repo was required under PRoot's simulated root; `core.fileMode=false` used |
| SQLite | WAL, cross-process writer contention, reopen and integrity checks pass in this fixture |

This is a useful ordinary-files workspace, with fewer semantics than a private
Linux filesystem. Production integration should apply/verify Git compatibility
for explicitly selected repositories, without wildcard `safe.directory` trust.
Do not promise symlink-heavy trees, executable installs, case-distinct files or
software requiring `flock`. Keep runtime executables, provider homes,
credentials, YA databases and caches private. A project's SQLite test passing
does not move YA's internal databases here or prove crash/power-loss behavior.

### Checks and evidence limits

Passed: fixture `assembleDebug` and warning-free Android lint; Python syntax;
MC Android adapter's ten tests; YA `pnpm lint`, `pnpm format:check`,
`pnpm typecheck`, `pnpm test`; and shared Alpine `tools/host.py smoke`.
The native consent/status fixture has no editable text field or production input
path. Linux smoke proves shared-runtime behavior, not Android lifecycle.

Raw event streams, hash manifests, instrumentation results, device selection and
captures remain in ignored host `.local/workspace-spike/`. A UI lifecycle issue
in the controller initially stopped recovery before revocation: instrumentation
ends the fixture activity, so the runner now explicitly relaunches it before
using its revoke button. Saved provider evidence was independently rechecked
before continuing; inference was not repeated just to retry UI automation.
Consent/revocation is controller-driven outside each probe process, consistent
with the separate
[permission-revocation instrumentation gap](../../../gaps/android-notification-test-revocation-kills-runner.md).
That published-companion gap is not fixed by this fixture.

Successful cleanup removed the disposable app and sentinel-checked owned tree;
temporary inference grants were revoked and their rejection checked, the owned
USB reverse was removed, and accessibility settings were unchanged. The
signed-in host and existing documents were preserved. No production workspace
feature, arbitrary SAF write adapter, reboot/Doze, power-loss durability or
store-policy acceptance is claimed.
