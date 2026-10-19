import { describe, expect, it } from "vitest";
import { sessionPageRoute } from "../lookup";

const ID = "dgeameddpnggdeenoekpiaacfghdodch";
const PATH = "/-/relay/kyle/projects/L1VzZXJz%3D/sessions/abc-123";
const ROUTE = {
  relayUsername: "kyle",
  projectId: "L1VzZXJz=",
  sessionId: "abc-123",
};

describe("sessionPageRoute", () => {
  it("reads session pages of this extension and the hosted app only", () => {
    expect(sessionPageRoute(`chrome-extension://${ID}${PATH}`, ID)).toEqual(
      ROUTE,
    );
    expect(
      sessionPageRoute(`https://yepanywhere.com/remote${PATH}?tab=1#x`, ID),
    ).toEqual(ROUTE);
    expect(
      sessionPageRoute(`https://latest.yepanywhere.com${PATH}/files`, ID),
    ).toEqual(ROUTE);
    // Another extension, a lookalike domain, plain http, non-session pages.
    expect(sessionPageRoute(`chrome-extension://other${PATH}`, ID)).toBeNull();
    expect(
      sessionPageRoute(`https://notyepanywhere.com${PATH}`, ID),
    ).toBeNull();
    expect(sessionPageRoute(`http://yepanywhere.com${PATH}`, ID)).toBeNull();
    expect(
      sessionPageRoute(`https://yepanywhere.com/-/relay/kyle/projects/p`, ID),
    ).toBeNull();
    expect(
      sessionPageRoute(
        `https://artifact-${"a".repeat(32)}.yepanywhere.com${PATH}`,
        ID,
      ),
    ).toBeNull();
    expect(sessionPageRoute("not a url", ID)).toBeNull();
  });
});
