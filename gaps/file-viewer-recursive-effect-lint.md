# Recursive file viewer reference triggers conflicting hook diagnostics

`pnpm lint` warns that the layout effect in
`packages/client/src/components/FilePathLink.tsx` needs `FileViewerModal` in
its dependency list. Adding that self-reference produces the opposite warning:
the function changes on every render and should not be a dependency. The
effect constructs a render callback for a nested instance of the same exported
component; this is not a missing speech dependency.

Resolve the recursive component boundary or the lint false positive separately.
A mechanical dependency-list edit does not clear the diagnostic and could
misrepresent the lifecycle. The speech setup change leaves the file unchanged.

Found 2026-09-16 while verifying speech backend setup.
Contributing-model: 6-Astra
