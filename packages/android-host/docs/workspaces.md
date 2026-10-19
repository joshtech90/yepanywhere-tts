# Android workspace direction

Status: implemented in the experimental host, 2026-10-18. Physical acceptance
and remaining limits are recorded below.
Owning topic: [durable user-owned workspace](../../../topics/android-host.md#durable-user-owned-workspace).

## One collection of folders, two access methods

Users should be able to save several named folder shortcuts, such as `docs`
for `Documents/FolderB` and `downloads` for a child of Downloads. Select each
through Android's folder picker. A shortcut records a selected root; it does
not copy files, grant broad authority or create a Unix symlink.

**Pick folder** opens Android's picker immediately, without a name field. The
selected folder's display name becomes its shortcut name, preserving case,
spaces and Unicode. If that name is already used, append the first available
`-1`, `-2`, `-3`, and so on. Names are bounded to 48 UTF-16 code units; trim the
base as needed to fit a suffix without splitting a surrogate pair. Replace
slashes, backslashes, colons and control characters with `-`, trim outer
whitespace, and use `folder` if the result is empty, `.` or `..`.

**Rename** remains an optional action after selection and changes only the
shortcut. **Reselect** repairs an existing registration while keeping its
shortcut name and requested direct access. Existing registrations keep their
names after an app update. Selecting an already registered folder reports its
existing shortcut instead of adding a second registration. Canceling the picker
leaves registrations unchanged.

| Access method | Authority | Agent interface |
| --- | --- | --- |
| Direct filesystem | Explicit optional all-files permission plus a qualified local-folder selection | Ordinary paths such as `/workspaces/docs`; existing shell, Python and provider file tools |
| SAF documents | Individual persisted folder grants; no all-files permission required | Explicit `ya saf` operations against a named root |

The same folder can support both methods. A SAF-only root remains useful for
document operations even when it cannot be exposed as a filesystem directory.
Arbitrary document providers belong to that explicit SAF interface; their
content URIs are not converted into invented local paths.

The host must remain usable without all-files access. Private projects remain
an explicitly private choice with their existing app-data lifetime. They are
never a substitute for an unavailable durable folder.

## Built-in primary shared storage

Enabling optional all-files access exposes the phone's primary shared storage
at `/sdcard` on the next host start. No folder selection or SAF grant is needed
for this mapping. `/sdcard/Download`, `/sdcard/Documents` and `/sdcard/DCIM` refer
to the actual shared files; `/sdcard` is Android's conventional name and does
not mean a removable card. Android's StorageManager supplies the current primary
volume directory instead of a hardcoded user number/path.

The native folder screen shows current availability and whether the running
host applied it. Use the controlled restart action after a permission change;
existing processes keep their original bindings. No permission or unavailable
storage yields a blocked `/sdcard`, never a writable app-private fallback.
Before a provider starts with a working directory under `/sdcard`, recheck
actual all-files authority, mounted storage and the applied source identity.
This admission check does not revoke already open handles or confine other
commands from accessing paths outside their working directory.

Folder shortcuts under `/workspaces` remain optional conveniences into the
same files. Removing a shortcut or releasing its SAF grant does not remove
access through `/sdcard` while broad authority is enabled. SAF-only operation
remains independent. Runtime, credentials, sessions and internal databases stay
private. Android's restrictions on other apps' private storage and protected
shared-storage directories still apply.

Removable cards are distinct volumes; they must never replace what `/sdcard`
means. Their production mapping and removal/reinsertion contract are described below.

## Optional direct filesystem access

Request broad authority only when the user chooses direct access, separately
from selecting folders. Explain that this permits reading, modifying and
deleting files throughout accessible shared storage, including Downloads and
Documents. It does not limit the app to the saved shortcuts or expose other
apps' private internal storage. The picker chooses workspaces; all-files
permission supplies raw-path authority. PRoot supplies no extra Android
authority and is not a folder-confinement boundary.

Qualify each local root independently using MC's existing native resolver.
Use distinct PRoot targets under `/workspaces/<name>` so multiple selected
folders can be accessed simultaneously. Writes must reach the actual external
files directly, with no app-private working copy, publish step or asynchronous
synchronization. Projects/sessions select an available direct path as their
working directory and use the existing provider tools unchanged.

Names must be unique, safe single path components; reject traversal, ambiguous
aliases and colliding mount targets. Preserve names across ordinary restarts.
Changing a name changes the agent-facing path and must be explicit. Source
folders may overlap; detect duplicate/overlapping selections and surface their
shared file identity instead of presenting them as independent copies. Direct
targets remain disjoint. These mappings do not depend on shared storage
supporting symlinks.

Android restricts selecting the Downloads directory itself on modern versions;
children such as `Downloads/FolderA` remain the intended selection. Only
provider/volume routes actually qualified by MC may receive direct mappings.
The current resolver qualifies the built-in primary external-storage provider;
removable storage is not established by this direction.

Mapping changes apply through a controlled runtime
restart. Show pending changes and active-session consequences before applying;
do not abruptly stop provider work or claim an existing process adopted a new
mapping. Recheck availability before admitting work. One unavailable root must
not disable healthy roots, or become an empty directory that accepts private
writes. Missing paths must fail visibly. Running-handle/session revocation
requires separate implementation and validation.

## SAF CLI/document access

The installed `ya saf` CLI uses the same shortcut names. Native operations live
in MC's `SafDocuments`; YA owns the saved roots and a foreground-host bridge.
The bridge accepts only the actual Android app UID, and the CLI verifies the
server UID. Its random endpoint is private runtime state. It closes with the
host; start the local host before using the CLI.

```sh
ya saf roots
ya saf ls docs
ya saf ls "Shared Files"
ya saf stat docs notes.txt
ya saf mkdir docs drafts
ya saf put docs drafts/notes.txt /home/user/notes.txt
ya saf get docs drafts/notes.txt /home/user/notes-copy.txt
ya saf rename docs drafts/notes.txt revised.txt
ya saf rm docs drafts/revised.txt
ya saf rm docs drafts --recursive
```

`put` and `get` refuse an existing destination unless `--replace` is supplied.
`rename` accepts a new leaf name within the same parent and refuses replacement;
there is no cross-root move. Selected roots cannot be renamed/deleted by these
document commands. The native UI's Rename changes only the shortcut.

The registry supports 16 roots and shortcut names of 1–48 UTF-16 code units
excluding `.`, `..`, slashes, backslashes, colons and control characters. Quote
shortcut names containing spaces or shell metacharacters in shell commands;
use `--` before positional arguments beginning with `-`.
Document paths allow 32 relative path components/4096 characters,
2048 children per listing and 64 MiB transfers. The native bridge has four
workers, four queued clients and a 30-second request deadline. Provider queries
receive cancellation; an uncooperative provider may still occupy a bounded
worker until it returns. No persistent descriptor cache is used. Uploads are
fully received into a bounded private temporary file before external mutation;
a partial transport upload does not modify the document. Once provider writing
starts, cancellation/errors can leave a partial destination. Downloads complete
and fsync a local temporary file before publication. Temporary files are removed
on request cleanup; app reset removes any residue from abrupt process death.

Each operation uses the root's actual persisted grant and current provider
capabilities. Listing, reading, writing and provider-supported namespace changes
must report their own results. A local edit changes the external document only
after explicit successful transfer. Never describe cached bytes, a queued
transfer or a failed export as a completed durable write. Do not promise POSIX
rename/replace, random I/O, locks or fsync for arbitrary providers.

Bound listings, transfers, open descriptors and cancellation cleanup. Reject
ambiguous duplicate names, traversal and unsupported operations rather than
selecting an arbitrary document or silently changing semantics. Grant loss,
offline/provider errors and partial writes must be visible. Cloud upload and
durability guarantees remain provider-specific and require separate evidence.
JSTorrent's seekable-descriptor patterns are a reference, not proof of a
general filesystem namespace.

## Removable-card investigation

The attached Motorola identified as Moto G Power (2022), Android 12, with one
mounted public exFAT volume. A disposable fixture queried StorageManager and
bound that exact removable directory into PRoot at `/external-card` for this
investigation only. With all-files authority and zero SAF grants, Python and
shell I/O reached the real card; independent controller reads matched its
bytes/hashes. Process restart, broad-permission revocation and re-enabling after
fixture app-data clear preserved/recovered both primary and card files. Only
new UUID-named folders were written and removed; no formatting, ejection or
existing-document changes occurred.

Both tested volumes passed positional writes, rename/replace, file/directory
`fsync`, Git with explicit repository trust, `core.filemode=false` and
`core.createObject=rename`, and a basic SQLite WAL roundtrip. They were
case-insensitive, rejected symlinks and ignored executable-bit changes. `flock`
returned ENOSYS; POSIX record locks were accepted. This is a basic acceptance
fixture, not proof of lock contention, power-loss safety, safe card removal,
SQLite workloads or complete POSIX compatibility. Runtime binaries and YA's
live databases should continue to stay private.

## Built-in removable-volume mappings

Optional all-files access also exposes every mounted, writable, accessible
removable volume at `/storage/<volume-id>` on host start. No SAF selection is
needed. Android StorageManager supplies each volume's UUID and canonical source;
labels and enumeration order never determine paths. Multiple volumes coexist
without replacing `/sdcard`. Missing/unsafe IDs and duplicate IDs are reported
as unavailable; inaccessible or read-only volumes are not bound. `/storage`
is a protected namespace with blocked entries for observed unavailable cards,
so a missing mapping cannot silently become writable private storage.

`ya saf roots` also reports these volume paths/status alongside saved roots.
The folder screen lists each detected volume's label, stable path and current
availability, separately from the applied runtime mapping. New cards and changed
mappings require the existing explicit start/restart control and interruption
confirmation. No runtime, credentials or internal database moves to a card. Durability here
applies to ordinary shared folders; Android app-specific directories retain
their Android-managed deletion lifetime.

Each new provider launch beneath `/storage/<volume-id>` asks the native bridge
to recheck actual all-files authority, current writable mount state, unique
volume identity and the applied canonical source. Unknown volumes are refused.
The host watches protected Android media broadcasts while running, and marks
the affected applied volume stale on a mount/unmount/eject/removal transition.
Even reinserting the same card requires an explicit restart before admitting
new work on it. Primary storage and other volumes remain independently usable.
The visible folder screen also refreshes on media events; both watches close
with their owners, without polling or per-folder watchers.

This is admission and mapping lifecycle handling. It cannot make an in-flight
write safe during unplugging, revoke already-open descriptors, or prevent an
already-running program from opening a same-ID card after reinsertion. Existing
I/O must handle Android's errors; finish work before removing a card. Filesystem
UUIDs are Android's portable-volume identity, not cryptographic proof against
a deliberately cloned card. Reformatting changes that identity and therefore
its path. Reset/reinstall recovery needs re-enabling broad permission and
restarting with the existing card; no erased YA registry is needed.

Selected-folder direct shortcuts still qualify primary-storage SAF roots only;
removable documents can use `ya saf`, while ordinary filesystem work uses the
new `/storage/<volume-id>/...` paths. Arbitrary SAF providers do not become
filesystem mounts. The earlier `/external-card` path was fixture-only; the
acceptance runner now exercises production removable mappings.

## Identity, permissions and recovery

Keep root registration, shortcut name, requested access methods and provider/
document identity separate from current grant health and derived local path.
Display availability per root and method: a healthy SAF root can have direct
access disabled/unavailable, while another root remains fully usable. Losing
all-files access invalidates direct access without deleting registrations or
files; SAF access can remain available under its own grant.

Removing a shortcut unregisters it and releases grants no remaining registration
needs. It must not delete the selected folder's contents. Releasing SAF access
can enforce YA admission policy, but cannot revoke raw-path authority while
all-files remains active. Removing a PRoot mapping is likewise not a security
boundary against code running as the app UID. No transition silently switches
a project to another access method or a private copy.

Files in selected external folders must survive clearing app data and
reinstallation. Registrations, names and grants may be erased. Recovery means
selecting the existing folders, granting access again and recreating their
shortcuts; it cannot depend solely on the erased registry, a hidden YA project
marker or a matching display name. A moved/missing folder requires explicit
repair. Recreating the same names restores intended paths but does not restore
erased credentials, provider sessions or internal databases.

Runtime binaries, provider homes, credentials, YA databases, logs and caches
remain private by default. Selecting a root creates no YA metadata or Git
configuration inside it. Any future Git compatibility configuration must respect
the [project storage contract](../../../topics/project-directory-storage.md) and
use explicit repository trust rather than wildcard `safe.directory`.

## Physical acceptance and limits

The [completed single-root spike](../workspace-spike/README.md#evidence) measured
ordinary CRUD, positional writes, rename/replace and fsync on Pixel 7a/API 37.
Its shared filesystem was case-insensitive, did not support symlinks/execution,
ignored executable bits and returned ENOSYS for `flock`. POSIX record locking
and bounded SQLite WAL contention passed. Git required rename-based object
publication, disabled file-mode tracking and explicit repository trust. Those
measurements are a bounded fixture, not crash/power-loss safety or a complete
Linux filesystem contract. Keep installed runtimes, executables, credentials and
YA's live internal databases private. No automatic Git trust/configuration or
project marker is written by workspace onboarding.

Multi-root host acceptance uses the production HostService/server/provider code
in an isolated `-PworkspaceFixture` Debug application on loopback port 13420.
The normal host retains port 13400 and can keep running during these tests. Only that build includes
its test receiver and typing instrumentation; normal host builds include neither.
It creates two exclusively owned UUID trees under Documents and Download,
records a private recovery receipt, uses actual picker/Settings controls, and
checks files from independent Android shell byte/hash reads. Temporary AAR
credentials and ADB forwards/reverses are removed in cleanup; receipts remain on
failure. Never reuse this fixture ID for the signed-in host.

```sh
# Prepare the shared runtime first, then build the isolated native fixture.
packages/android-host/gradlew -PworkspaceFixture :app:assembleDebug :app:lint
cp packages/android-host/app/build/outputs/apk/debug/app-debug.apk \
  packages/android-host/.local/workspaces-fixture.apk
python3 packages/android-host/tools/workspaces_live.py \
  --device-file <private-device-json> --machine-control <MC-checkout> \
  --aar-checkout <AAR-checkout>
```

The private device JSON holds an explicitly selected serial. The runner uses
MC doctor and verifies the explicitly selected model (Pixel 7a by default)
before mutation. On failure, inspect
its ignored evidence and use `--resume <private-evidence-directory>` to verify
ownership witnesses, replace only the failed fixture resources, and repeat.
The [instrumentation revocation gap](../../../gaps/android-notification-test-revocation-kills-runner.md)
informs permission changes from a separate controller. Signed-in host data and
existing documents must remain untouched by reset/reinstall tests.

For a focused native picker/naming check, add `--picker-only --model 'Pixel 9'`
and omit `--aar-checkout`. This mode needs the fixture APK/native libraries but
no staged Alpine runtime or provider credentials. It uses three exclusively
owned folders with matching display names under Documents, Download and Pictures,
including spaces and uppercase letters. It checks automatic suffix allocation,
reuse of a freed suffix, cancellation, duplicate identity rejection, optional
rename, reselect, process restart and sequential typing with 16 visible roots.
External byte/hash checks and exact-resource cleanup apply in both modes.

For primary storage and optional production removable-volume acceptance, build/copy
the isolated APK to `.local/shared-storage/fixture.apk`, prepare the shared
Alpine payload, then run:

```sh
python3 packages/android-host/tools/shared_storage_live.py \
  --device-file <private-device-json> --registry <private-MC-registry> \
  --target <selected-target> --model '<observed-model>'
# Add --external for one mounted removable volume; --ui also checks native
# host startup/mapped status and 16-root sequential typing on an unlocked phone.
```

This runner uses only the disposable workspace fixture, native StorageManager,
production workspace binding/bridge code and real Alpine Python/Git/SQLite.
Runtime transfers are compressed and verified against the prepared payload hash. It
uses actual Android Settings by default. `--headless-permission` changes only
the disposable fixture's all-files app-op and permits a locked display when
ADB, boot, administration and credential-encrypted storage are ready. It tests
blocked writes without permission, no-picker/no-SAF primary access, process
restart, revocation, fixture data-clear recovery and independent bytes/hashes.
`--external` exercises the production `/storage/<volume-id>` binding, same-runtime
media invalidation, and a fixture-only disappearing-source check that refuses
private fallback writes. Exact owned
resources remain in a private recovery receipt on failure; `--resume` verifies
ownership before replacing them. No card format/eject operation is performed.

**Production removable mapping acceptance passed, 2026-10-18:** Moto G Power
(2022)/Android 12 with its public exFAT card passed the production
`/storage/<volume-id>` binding, independent bytes/hashes, actual Settings broad
permission, zero SAF grants, process restart, revocation and fixture-data-clear
recovery. A synthetic media event used the same native event handler, including
an Android mount-path/case alias; an unrelated event left the healthy card
alone. The affected card rejected new work until restart while `/sdcard` stayed
available. A fixture-owned source directory was also detached while PRoot was
running; ordinary writes and directory creation failed without private fallback.

The real foreground host then started alongside the normal Motorola host on
the fixture's separate port. Its native folder screen showed both volumes
mapped, and 16-root sequential typing acknowledged all 16 characters within
22 ms. The normal Motorola host was not stopped or changed. Fixture app and
owned shared trees were removed. This extension used production binding/native
admission with Python, Git, SQLite and native host UI; it did not repeat real
provider inference, physically unplug the card, or test power loss. Root checks,
Linux admission, Alpine smoke and Android Debug/Release build/lint passed.
Machine Control commit `9b0c532` owns the reusable removable-volume resolver.

The normal Pixel 9 was also updated over mDNS-selected Wi-Fi ADB with the
latest normal APK and shared payload. Before restarting, every one of its
1889 private-state file hashes and its existing folder registry matched the
pre-update snapshot. Its native screen confirmed the running primary mapping;
no user documents were changed.

**Built-in `/sdcard` acceptance passed, 2026-10-18:** Pixel 9 over Wi-Fi ADB
via mDNS and Moto G Power (2022) over USB passed the fixture checks above,
including zero SAF grants, blocked access before permission, direct writes,
process restart, revocation and recovery after clearing only the disposable
fixture's data. Motorola used actual Settings; the Pixel fixture used the
headless app-op route. Both fixtures and their owned shared-storage trees were
removed. On Motorola, the native folder screen and 16-root Rename typing check
passed with all 16 sequential characters acknowledged within 78 ms. Root lint,
format, typecheck and tests, Alpine smoke, Linux native-socket admission checks
and normal/fixture Android build/lint passed. Machine Control commit `b9b0c34`
owns the reusable primary-volume resolver under its MIT license.

The normal Pixel 9 host was then updated over Wi-Fi ADB via mDNS with a fresh
shared runtime, preserving byte hashes of all 566 private-state files and the
existing folder registry before restarting it. The running production PRoot
command contained the primary-storage binding, native admission accepted it,
and the running YA server confirmed `/sdcard/Download` and `/sdcard/Documents`
as accessible project directories with no selected shortcuts. This final check
was read-only; user documents and the normal Motorola host were untouched.

**Picker-first follow-up passed on Pixel 9 over Wi-Fi ADB, 2026-10-18:**
three actual picked roots preserved their display names, spaces and case;
collisions used `-1` and `-2`, and removal made `-1` available again. Cancel,
duplicate rejection, Rename, Reselect and process restart preserved registrations
as expected. Sixteen sequential keys during a 16-root refresh acknowledged in
at most 36 ms. Independent hashes of all three external witnesses stayed
unchanged, and the disposable app and exact owned trees were removed. A separate
actual PRoot binding check preserved spaces, Unicode and trailing `!` names in
owned private-cache fixtures. The normal APK update preserved all 571 existing
private-state file hashes; no runtime restaging or user-document mutation occurred.

**Passed on explicitly selected Pixel 7a/API 37, 2026-10-18:**

- Two actual folder selections, separate all-files Settings consent, simultaneous
  direct mappings and two normal YA projects rooted in different folders.
- Real Codex and Claude YA sessions each wrote into both roots, including Python
  positional writes and fsync; independent Android byte reads and SHA-256 checks
  verified 10 external files. The guest retained its private runtime/provider home.
- SAF CRUD and binary get/put round trips on both roots without broad access;
  existing-file overwrite and traversal refusal; incomplete transport upload
  preserved an existing external destination.
- Host force-stop/restart, independent per-root grant revocation/refusal and real
  reselection repair; broad access disabled while SAF metadata operations remained
  available after host restart. Other roots stayed usable under their own grants.
- Explicit controlled mapping restart, picker cancellation, native shortcut rename
  and removal, and unchanged external hashes after those registration changes.
- Both data-clear/reselection and uninstall/reinstall/reselection of the disposable
  fixture recovered the existing external bytes through both methods.
- Real sequential typing of 16 characters while asynchronous status refreshed:
  no lost keys, maximum acknowledgement 24 ms in the two-root acceptance run.
  A supplementary instrumented run refreshed status during every character with
  16 registrations (synthetic unavailable roots filling the UI to its limit):
  no lost keys, maximum acknowledgement 29 ms. Its temporary registry was removed.
- Unchanged accessibility settings; temporary AAR clients rejected with 401 after
  revocation; owned transports, fixture app and both owned external trees removed.

A separate Linux abstract-socket check exercised fragmented response framing and
fresh rejection after revocation in the server's actual admission helper. Android
Debug/Release builds and lint, root lint/format/typecheck/test, MC Android tests,
Python compilation and the shared Alpine auth/SQLite restart smoke passed. An
intermittent unrelated glossary scan-count assertion is recorded in
[its gap](../../../gaps/glossary-concurrent-join-extra-refresh.md); the subsequent
full server and full workspace runs passed unchanged. Existing negative-path
suite diagnostics remain tracked in the [warning gap](../../../gaps/unit-failure-path-log-warnings.md).

The updated normal host APK/runtime was then installed on the same device;
all 135 pre-existing private-state file hashes matched before and after staging.
No user folder was registered or modified in that host. Its native launcher was
opened with the service stopped for the user's next launch.

The implementation does not establish arbitrary SAF/cloud-provider behavior,
provider power-loss durability, cancellation rollback, descriptor-leak soak
coverage, duplicate-name-provider conformance, or revocation of already running
sessions/handles. Duplicate-name rejection and provider-specific failure paths
are implemented but not qualified by a synthetic hostile DocumentsProvider.
