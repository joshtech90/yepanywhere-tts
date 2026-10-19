# In-session rendez observers shown as user uploads

Extends [rendez uploads](../../topics/rendez.md).

## Desired outcome

A session running the `rendez` helper's in-session observer (`rendez watch`)
receives each upload as tool output, which YA currently shows as ordinary
background tool output. YA could instead present each such delivery as a user
turn with a visible attachment chip, matching uploads YA delivers itself.

## Proposed approach

- Detect that a session runs an in-session observer, for every provider, from
  its tool activity or from the observer's subscription and output records
  under `.rendez/delivered/<route>/` (`transport: "output"`).
- Render those deliveries with the attachment presentation YA already uses for
  `User uploaded files:` sections.
- While any session in a project runs an in-session observer that YA has
  detected, deregister YA's own project observer for that project, and restore
  it when the session's observer stops.

## Unresolved

- Detection must be reliable for every provider before YA stops observing;
  missing a stop would leave the project unwatched.
- Whether YA's observer must stop at all: today an in-session observer serves
  only its own route, so both can run. Stopping matters only if in-session
  observers come to serve `latest-session`.
- Whether the presentation needs a transcript-level marker rather than parsing
  tool output.
