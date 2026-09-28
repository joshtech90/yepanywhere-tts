# Source edits leave artifact source-map locations stale

The initial [source editor](../topics/file-source-editing.md) navigates to the
original file using producer-authored line/column ranges. Saving inserted or
deleted lines does not remap the frozen artifact. A later click can therefore
open the wrong location. The current warning makes this visible, but no source
hash in the map is checked, and reopening the editor does not detect a map that
was already stale. Conditional save hashes prevent overwriting changes since
opening; they do not validate mapping provenance.

This is an explicit initial compromise. Add source/artifact revision binding,
reject mismatched maps before navigation, and refresh targets atomically with
the [rebuilt artifact](artifact-source-edit-rebuild.md). A durable target id can
restore reading position after rebuilding. Character-level mappings and runtime
DOM mapping remain in the [source-map sketch](sketches/source-mapped-artifact-editing.md).

Found 2026-09-22 while implementing approximate original-source navigation.
Contributing-model: 6-Astra
