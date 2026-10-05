# Reviewed libsodium source

This is the upstream signed `libsodium-1.0.22-stable.tar.gz` distribution
previously used by the native builds, retained here because the upstream stable
URL is mutable. The source archive includes upstream licenses.

- Origin: https://download.libsodium.org/libsodium/releases/libsodium-1.0.22-stable.tar.gz
- SHA-256: `25c47d0cbf804bf28f3a1166dc145ee013e31a8dc78bb0c9d74273fb44260567`
- Upstream Minisign key: `RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3`
- Signed timestamp: `1790811276`.

Verified against the upstream public key on 2026-10-02. The fresh signed archive
at that URL had a different hash, but identical source contents, member order
and extracted metadata. Its tar bytes differed only in PAX header names and
their checksums. Keeping the original distribution preserves the existing
source and pin rather than depending on another mutable download.

`scripts/sodium.mjs` verifies the checked-in bytes before copying them and the
signature into the build directory. `libsodium-sys-stable` verifies the upstream
signature during Cargo builds. Updates must review both source changes and the
signature, replace this pair and the script's hash together, and rerun native
acceptance.
