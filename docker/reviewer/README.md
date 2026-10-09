# Reviewer demo

Use a dedicated Linux VM containing only synthetic data. The native app currently
uses an owner login, so a mock provider alone does not restrict authenticated
access to files, terminals, commands, settings, or remote-access configuration.
Never use the development compose file, personal home mounts, provider tokens,
SSH keys, or a Docker socket in this container.

Build `pnpm build:bundle`, then build the image from the repository root with
`docker build -f docker/reviewer/Dockerfile -t yep-reviewer .`. The image installs
no provider CLI. `USE_MOCK_SDK=true` supplies the normal server's in-process mock
provider. The image's explicit preload supplies canned responses and writes
normal provider history under the synthetic home, so new and resumed turns
remain visible after reconnect. It calls no AI service and executes no model
commands. Production providers and the ordinary test mock are unchanged.

Initialize an empty volume with `reviewer-seed.mjs`, piping a private JSON
credential record on stdin, with network disabled. Use the same fixed container
hostname for seeding and serving so the native provider history is discovered.
Keep the original credential outside the image and repository. The seed creates
two fictional projects, transcripts, an installation identity, and the normal
SRP relay verifier. Do not rerun it against a live volume.

Serve as UID 1000 with a read-only root filesystem, all capabilities dropped,
`no-new-privileges`, a PID limit, memory/CPU limits, and a bounded temporary
filesystem. Only the synthetic `/demo` volume is writable. Host networking here
means the **dedicated guest**, never the laptop. Listen on guest loopback and
register outbound through the public relay; no router forwarding is required.
The guest firewall must restrict UID 1000 to loopback, DNS to its configured
resolver, and HTTPS to the relay and notification broker's resolved addresses.
Block IPv6 egress too unless an equivalent allowlist is configured. Test refused
LAN, hypervisor, metadata, arbitrary Internet, privilege, and filesystem access
from the running container before handing out the login.

Retain a clean, private recovery copy of the synthetic volume. Reviewers have
owner access and can alter sample data or disable their remote login. Recovery
must restore the original installation identity and SRP verifier, not register
a new installation against an already claimed relay name. Do not reset during
an active review. Run the service and VM automatically after host reboot, and
check remote login after a service restart. Concrete VM identity, controller
keys, login credentials, firewall addresses, and recovery commands belong in
the private dotfiles deployment runbook.
