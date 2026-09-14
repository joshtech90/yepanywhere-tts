# Releasing and deployment

[Contributor guide](../../DEVELOPMENT.md) · [Development docs](README.md)

Commands and code paths below are relative to the repository root unless stated
otherwise.

## Releasing to npm

The package is published to npm as `yepanywhere` using GitHub Actions with OIDC trusted publishing (no npm tokens stored in secrets).

**Before releasing:**

1. Update `CHANGELOG.md` with a new version section:
   ```markdown
   ## [0.1.11] - 2025-01-24

   ### Added
   - New feature description

   ### Fixed
   - Bug fix description
   ```

2. Commit the changelog update

3. Tag and push:
   ```bash
   git tag v0.1.11
   git push origin v0.1.11
   ```

The CI workflow verifies the changelog contains an entry for the version being released. If missing, the release will fail with instructions to update the changelog.

The workflow runs lint, typecheck, and tests, then builds with `pnpm build:bundle` and publishes with `--provenance` for supply chain attestation. It also creates a GitHub Release with auto-generated notes.

## Releasing the Website

The website (landing pages + remote relay client at `/remote`) is deployed to GitHub Pages separately from npm. **Pushing to main does NOT deploy the site** — it only runs CI (lint, typecheck, tests). The site only deploys when a `site-v*` tag is pushed (or via manual workflow_dispatch).

See [site/RELEASING.md](../../site/RELEASING.md) for the full process.

Quick reference:
```bash
# Update site/CHANGELOG.md first, then:
scripts/release-website.sh 1.5.3
```

## Deploying to Staging

The staging deploy runbook is host-specific and intentionally kept out of this public
repo. It lives in the private dotfiles repo: `~/code/dotfiles/machines/pi/README.md`. If
asked to deploy to staging, read the steps there.
