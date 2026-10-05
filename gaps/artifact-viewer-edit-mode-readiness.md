# Artifact viewer Edit source dialog intermittently fails to appear

[CI run 36887819900](https://github.com/kzahel/yepanywhere/actions/runs/36887819900)
on `b8346ebab` reported the artifact viewer icon-mode case as flaky. At
`packages/client/e2e/artifact-viewer.spec.ts:244`, the exact `Edit source`
dialog never appeared within the existing 5-second assertion; its retry
passed. The shard's uploaded browser evidence includes both first-attempt
screenshots and the error context for
`artifact-viewer-viewer-ico-87485-ugh-Shift-and-middle-clicks`.

Found beside the native mobile CI repair. That repair does not touch artifact
viewer editing, and this wait is not the native typing requirement. Diagnose
the mode transition from the uploaded evidence before choosing a change;
no assertion or retry policy has been weakened to hide it.

Found 2026-10-01 while repairing simulator and native WebView CI.
