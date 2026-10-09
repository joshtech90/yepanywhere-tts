# Security alerts outside the pnpm workspace need separate triage

On 2026-10-08, GitHub reports 14 open Dependabot alerts in the website,
sharing worker, and known-good STT snapshot: eight high, three moderate,
and three low. These graphs are outside the root `pnpm audit --prod` CI
gate. A passing workspace audit does not establish that these findings are
fixed or unreachable.

| Manifest | Package and checked-in version | Patch floor reported by GitHub | Alerts |
| --- | --- | --- | --- |
| `site/package-lock.json` and `sharing-worker/package-lock.json` | `sharp` 0.35.4 | 0.35.5 | 156, 155: GHSA-wq5f-xc86-pv6w |
| `site/package-lock.json` | `source-map-js` 1.2.1 | 1.2.2 | 152: GHSA-68fv-2mgg-jv7q |
| `site/package-lock.json` | `http-cache-semantics` 4.2.0 | No patch listed in the alert | 148: GHSA-ch52-4w7c-c8xp |
| `sharing-worker/package-lock.json` | `undici` 7.29.0 | 7.29.1 | 136, 135, 132, 131, 130, 129 |
| `requirements/stt-known-good-2026-06-16.txt` | `fsspec` 2026.4.0 | 2026.6.0 | 151: GHSA-27vj-qcqg-25rc |
| Same STT snapshot | `urllib3` 2.7.0 | 2.8.0 | 147, 146, 145 |

The six Undici advisories are GHSA-pmjh-fq2x-6v4x,
GHSA-r53p-7pc4-xj5r, GHSA-2jfj-6hjv-fm6j, GHSA-2gqq-gqf2-x968,
GHSA-w293-vg96-wgc3, and GHSA-8436-99hf-9mmv. The three urllib3
advisories are GHSA-gh4c-6fx4-qh6g, GHSA-vxq7-64xx-v4gw, and
GHSA-8988-9cw3-xx77. The [live alert list](https://github.com/kzahel/yepanywhere/security/dependabot)
owns current status and advisory details; counts and patch floors above
are the inspection snapshot.

Inspect each npm parent's declared range before choosing a targeted lockfile
refresh or a scoped override, then verify the website/worker build and audit.
Review the unpatched cache finding's consuming path separately. The STT pins
need resolution and compatibility evidence against their known-good Linux
environment, which CI does not exercise. Follow
[dependency maintenance](../docs/development/dependencies.md); do not add
workspace audit suppressions or dismiss alerts without reachability evidence.

These were captured separately from the bounded Renovate PR/configuration
pass because their independent npm graphs and held STT environment need
their own compatibility and reachability review. No advisory was dismissed
and no audit exclusion was added.

Found 2026-10-08 while following Renovate PRs through CI and merge.
