# Every catalog publication starts a full speech-vocabulary scan pass

`session-catalog-updated` starts a learning scan
(`packages/server/src/app.ts:2047`), and a live session republishes the catalog
every few seconds. The scan no longer writes anything when it observes nothing
new, but it still walks the whole retained catalog and asks
`hasScanned(key, version, cutoff)` for every session on every publication.

With a large history that walk is the remaining per-publication cost of the
feature while learning is on. A coalescing delay, or reacting only to the
sessions the event names as changed, would replace it with work proportional to
what actually changed.

Not fixed with the flush rewrite: that change was about what reaches disk, and
the scheduling question is a separate contract in
`topics/pluggable-speech-recognition.md` § Keyterm Biasing that deserves its own
measurement of what the walk actually costs on a large catalog.

Found 2026-09-09 while replacing the whole-table flush.
