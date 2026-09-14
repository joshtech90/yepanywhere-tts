# Scratch-space test assumes the OS temporary directory is disk-backed

`packages/server/test/lib/scratchSpace.test.ts` creates its override directory
under `os.tmpdir()` and unconditionally expects `reserveScratchSpace` to choose
it. On a host where `/tmp` is tmpfs, the implementation intentionally rejects
that candidate and the test fails despite correct placement behavior.

The failure reproduces with the default temporary directory and passes when
`TMPDIR` points at a disk-backed directory. Make the test control filesystem
classification at that boundary, with separate cases for accepted disk and
rejected memory-backed candidates. Left outside the browser measurement fix
because scratch placement is an independent server contract.

Found 2026-09-13 while bounding development browser measurement retention.
