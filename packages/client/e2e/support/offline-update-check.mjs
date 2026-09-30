// @ts-check
/** Keep unrelated public update traffic outside the browser-test boundary. */
/** @type {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} */
const realFetch = globalThis.fetch;

/**
 * @param {RequestInfo | URL} input
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
async function fixtureFetch(input, init) {
  let url;
  try {
    url = new URL(input instanceof Request ? input.url : String(input));
  } catch {
    return realFetch(input, init);
  }
  if (
    url.origin === "https://updates.yepanywhere.com" &&
    url.pathname.startsWith("/version/")
  ) {
    // Exercise the production no-update response, cache and route behavior.
    return new Response(null, { status: 204 });
  }
  return realFetch(input, init);
}
Object.defineProperty(globalThis, "fetch", {
  value: fixtureFetch,
  configurable: true,
  writable: true,
});

export {};
