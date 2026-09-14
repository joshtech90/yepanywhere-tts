# Delayed capability banners can make live commentary differ from replay

`ToolCommentaryBoundary` commits to ordinary output after an undeclared
invocation publishes its first stdout record. A provider that withholds the
initial stderr banner until after that point stays raw while mounted, whereas
replaying the complete result can recognize the banner and display commentary.
The feature deliberately avoids reclassifying already visible metadata, so
loosening the client detector would reintroduce the height jitter it prevents.

The owning fix is invocation capability provenance delivered before the first
tool preview, including providers that transport stdout and stderr separately.
That needs a provider/server output contract beyond the bounded rendering
endpoint. The present work recognizes declarations already carried in the
invocation output and makes no speculative discovery calls. See
[ACLI commentary](../topics/acli-commentary.md#activation-and-compatibility).

Found 2026-09-07 while implementing ACLI commentary presentation.
Contributing-model: 6-Astra
