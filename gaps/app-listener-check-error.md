# App listener checks can expose an unexplained lsof failure

A user opening the Plannotator pane saw `Command failed: /usr/bin/lsof`
for the configured listening port. The listener route in
`packages/server/src/routes/vhostApps.ts` returns the exception message from
`VhostAppControl.listener`, which omits the exit code, signal and timeout
classification needed to distinguish failure from app exit.

The same command against the still-running app succeeded during diagnosis.
A closed-port probe returned exit 1 with empty stdout/stderr, which the
existing implementation already translates to no listener. Do not treat every
command failure as app exit or broaden that catch without evidence.

Next: capture structured exit/signal/timeout details at this boundary and
reproduce the reported failure, then correct its cause. The pane displays
check failures explicitly and only auto-dismisses on confirmed no-listener.

Found 2026-09-16 while checking live Plannotator pane lifecycle.
