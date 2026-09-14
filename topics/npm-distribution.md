# npm distribution

## License contract

The published `yepanywhere` npm package declares `MIT` and includes the full
root `LICENSE` file, unchanged, at the package root. Its README links to that
file. Existing third-party license notices retain their own terms.

`pnpm build:bundle` stages the package in `dist/npm-package/` and fails if the
root license cannot be copied. A successful build must not silently omit it.
Verify the staged license matches the source and that `npm pack --dry-run
--json`, run from the staging directory, lists `LICENSE` before publishing.
