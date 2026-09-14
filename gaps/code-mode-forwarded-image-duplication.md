# Forwarded code-mode image output can repeat a nested tool image

A nested View Image result and the outer Exec result can both present the same
capture when the script forwards the image it read. The observed transcript
showed `phone.png` at 375×812 and then `tool-result-1.png` at the same size with
identical visible contents. This is separate from artifact commentary being
hidden by Conversation View.

Investigate the relationship between nested and outer tool results before
suppressing either. `packages/server/src/media/ToolResultMediaMessageMaterializer.ts`
deduplicates candidates within its own result; cross-invocation presentation
needs to preserve intentional repeated images and their tool provenance.
No fix was folded into the commentary/projection change because that layer
does not own this relationship. A regression should replay a nested View Image
plus its forwarded Exec image and assert one intended presentation, while
independent calls displaying the same file remain available.

Found 2026-09-08 while verifying artifact capture handoffs in Conversation View.
