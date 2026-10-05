# Relative links in the Local File Modal's HTML preview still go blank

Status: open.
Contributing-model: opus-5.5.

The File Viewer's scriptless HTML preview now resolves a relative link such as
`paper.pdf` against the previewed file and opens the target in the viewer
(`documentPath` and `onLocalResourceLink` on `ArtifactPreview`; contract in
[active content security](../topics/active-content-security.md)). The other
caller, `LocalFileModal` in `packages/client/src/components/LocalMediaModal.tsx`,
passes neither prop. Its preview therefore keeps the old defect: clicking a
relative link loads a YA route beside the embedding page and the frame shows
blank.

Not fixed in place because `LocalFileModal` owns no local-resource opener. The
fix is to give it one: call `useLocalResourceClick`, render the modals it
returns (as `FileViewer` does), then pass `documentPath={resource.path}` and
its `openResource` to `ArtifactPreview`. The e2e fixture's `?editor` branch
already renders `LocalFileModal` and can cover it.

Found 2026-09-30 while fixing relative links in the File Viewer's HTML preview.
