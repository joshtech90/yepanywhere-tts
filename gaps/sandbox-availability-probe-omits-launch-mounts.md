# Sandbox availability probe omits the launch-time mounts

`probeSessionSandboxAvailability` in `packages/server/src/session-sandbox.ts`
runs the network launcher with the fixed `BWRAP_PREFLIGHT_ARGS`, while
`prepareSessionSandbox` builds its args with `buildBwrapBaseArgs`: the project,
provider-state, cache and temp binds, the provider-host runtime mask and the
private resolver mount. A host can therefore report `available` and then fail
every launch.

Observed on Ubuntu: `/etc/resolv.conf` links into `/run`, which the sandbox
replaces with a tmpfs, so the resolver mount failed at launch
(`bwrap: Can't create file at /etc/resolv.conf`) while the probe passed and
New Session offered the toggle. That mount is now fixed (it targets the
resolved link), but the probe still cannot catch the next divergence of this
kind.

Cheap fix: have the probe build its args through `buildBwrapBaseArgs` with
throwaway state directories and a scratch resolver file, so it exercises the
same mounts a launch does. Not done in place because it widens the probe's
setup (temp directories, cleanup) beyond the resolver fix.

Found 2026-09-27 while enabling sandboxing on an Ubuntu host.
