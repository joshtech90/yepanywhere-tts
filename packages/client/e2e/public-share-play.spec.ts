import { expect, test } from "./fixtures.js";

const secret = "play-secret-4f2a";
const projectId = Buffer.from("/project").toString("base64url");

// The played document reports what it can observe to the play page, which
// records the reports for the test.
const probeScript = `
const report = (key, value) => parent.postMessage({ probe: key, value }, "*");
document.addEventListener("securitypolicyviolation", (event) =>
  report("violation", event.effectiveDirective));
addEventListener("load", () => {
  report("baseURI", document.baseURI);
  const form = document.getElementById("form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    report("submit", "handled");
  });
  form.requestSubmit();
  const nested = document.createElement("iframe");
  nested.src = new URL("/remote.html", document.baseURI).href;
  document.body.append(nested);
});
`;

const rootHtml = `<!doctype html><html><head><script src="probe.js"></script></head>
<body><form id="form"><button>Send</button></form>
<a id="jump" href="#target">Jump</a>
<div style="height: 3000px"></div><p id="target">Target</p></body></html>`;

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket("wss://share-relay.test/ws", (socket) => {
    socket.onMessage((wire) => {
      const message = JSON.parse(String(wire));
      if (message.type === "client_connect") {
        socket.send(JSON.stringify({ type: "client_connected" }));
        return;
      }
      const url = new URL(message.path, "http://share.test");
      const isRaw = url.pathname.endsWith("/files/raw");
      socket.send(
        JSON.stringify({
          type: "response",
          id: message.id,
          status: 200,
          headers: {
            "content-type": isRaw ? "text/javascript" : "application/json",
          },
          body: isRaw ? probeScript : { content: rootHtml },
        }),
      );
    });
  });
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const reports: Array<{ probe: string; value: string }> = [];
    (window as unknown as { __playReports: typeof reports }).__playReports =
      reports;
    addEventListener("message", (event) => {
      if (event.data && typeof event.data.probe === "string")
        reports.push(event.data);
    });
  });
});

test("the played document cannot see the share secret or frame this origin", async ({
  page,
  remoteClientURL,
}) => {
  const query = new URLSearchParams({
    h: "owner",
    projectId,
    path: "site/index.html",
    r: "wss://share-relay.test/ws",
  });
  const playUrl = `${remoteClientURL}/play.html?${query}`;
  await page.goto(`${playUrl}#share=${secret}`);

  const reports = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __playReports: Array<{ probe: string; value: string }>;
          }
        ).__playReports,
    );
  const reported = async (probe: string) =>
    (await reports())
      .filter((report) => report.probe === probe)
      .map((report) => report.value);
  await expect.poll(() => reported("baseURI")).toEqual([playUrl]);
  await expect.poll(() => reported("submit")).toEqual(["handled"]);
  await expect.poll(() => reported("violation")).toContain("frame-src");
  expect(JSON.stringify(await reports())).not.toContain(secret);

  // A fragment-only link still scrolls within the document.
  const frame = page.locator("iframe").contentFrame();
  await frame.locator("#jump").click();
  await expect(frame.locator("#target")).toBeInViewport();
});
