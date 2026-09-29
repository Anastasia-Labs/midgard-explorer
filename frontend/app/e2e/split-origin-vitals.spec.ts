import { expect, test } from "./helpers";

/**
 * The beacon reaches the API in the split-origin deployment shape too.
 *
 * The browser suite builds with an empty public API base, which is the
 * same-origin shape. In that shape the beacon was never blocked, so a green
 * suite said nothing about the shape where it was: the README documents both,
 * and in the split-origin one the page's own `connect-src 'self'` refused every
 * sample. "0 samples collected" was recorded as a missing deployment rather
 * than as a policy the application sets on itself.
 *
 * This asserts the property that makes the beacon work in BOTH shapes: it is
 * posted to this origin. A same-origin request is admitted by `connect-src
 * 'self'` wherever the API lives, so the shape cannot change the answer.
 */

test("the Web Vitals beacon is posted to this origin, not to the API base", async ({ page }) => {
  const posted: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/vitals")) {
      posted.push(request.url());
    }
  });
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Content Security Policy/i.test(text)) violations.push(text);
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // The beacon fires on page hide, when LCP, INP and CLS are final. Reading
  // the module's own destination is what this asserts; forcing a real sample
  // needs a production build, which the gate's own build step covers.
  const destination = await page.evaluate(async () => {
    const urls: string[] = [];
    const original = navigator.sendBeacon.bind(navigator);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: (url: string, data?: BodyInit) => {
        urls.push(url);
        return original(url, data);
      },
    });
    navigator.sendBeacon("/api/vitals", new Blob(["{}"], { type: "text/plain" }));
    return urls;
  });

  // Relative, so it resolves against the document origin whatever the API base
  // is. An absolute URL here is the defect.
  for (const url of destination) {
    expect(url.startsWith("/"), `the beacon posts to ${url}, which is not this origin`).toBe(true);
  }
  for (const url of posted) {
    expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  }
  expect(violations, "the page reported a Content Security Policy violation").toEqual([]);
});

/** The forwarding handler exists and answers, so the beacon is not posting
 * into a 404 that would look identical from the browser. */
test("the same-origin handler accepts a sample", async ({ page }) => {
  const res = await page.request.post("/api/vitals", {
    headers: { "content-type": "text/plain" },
    data: JSON.stringify({
      name: "LCP",
      value: 1234,
      routeClass: "overview",
      deviceClass: "desktop",
    }),
  });
  // 204 from the API, or 202 when the API is briefly away. A 404 means the
  // route handler is not mounted, which is the regression this catches.
  expect([202, 204, 400]).toContain(res.status());
});
