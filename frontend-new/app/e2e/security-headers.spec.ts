import { expect, test } from "@playwright/test";
import { hydrated } from "./helpers";

test("serves a nonce-based CSP without breaking hydration", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|refused to/i.test(message.text())) {
      violations.push(message.text());
    }
  });

  const response = await page.goto("/");
  expect(response).not.toBeNull();

  const headers = response!.headers();
  expect(headers["content-security-policy"]).toMatch(
    /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
  );
  expect(headers["content-security-policy"]).not.toContain("script-src 'self' 'unsafe-inline'");
  expect(headers["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("no-referrer");

  await hydrated(page);
  expect(violations).toEqual([]);
});

/* The three tests below exist because the pre-paint theme script carries
 * `suppressHydrationWarning`. That attribute is needed for a browser
 * transformation React cannot recognize (nonce hiding blanks the content
 * attribute after parsing, so React compares "" against the nonce it rendered
 * with and has no way to tell that apart from a real mismatch). The cost is
 * that it would equally silence a genuinely wrong nonce on that element, so
 * the guarantee it used to provide incidentally is asserted on purpose here. */

const nonceFromCsp = (csp: string | undefined): string => {
  const nonce = /'nonce-([^']+)'/.exec(csp ?? "")?.[1];
  if (nonce === undefined) throw new Error(`no nonce in Content-Security-Policy: ${csp}`);
  return nonce;
};

test("gives the pre-paint script the nonce the policy authorizes", async ({ page }) => {
  const response = await page.goto("/");
  const expected = nonceFromCsp(response!.headers()["content-security-policy"]);

  const script = await page.evaluate(() => {
    const el = [...document.querySelectorAll("script")].find((s) =>
      s.textContent?.includes("mg_theme"),
    );
    return el === undefined
      ? null
      : { property: el.nonce, attribute: el.getAttribute("nonce") };
  });

  expect(script, "the pre-paint theme script is not in the document").not.toBeNull();
  expect(script!.property).toBe(expected);
  // Documents the mechanism the suppression is there for: same element, same
  // moment, blank attribute. If a browser ever stops hiding the nonce this
  // fails, and the suppression can be removed rather than carried forever.
  expect(script!.attribute).toBe("");
});

test("runs the pre-paint script, so the nonce is genuinely authorized", async ({ page }) => {
  // A blocked script would leave the theme at its default and produce a flash
  // of the wrong colour scheme, which is precisely what the nonce buys.
  await page.addInitScript(() => window.localStorage.setItem("mg_theme", "light"));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("refuses an inline script that does not carry the nonce", async ({ page }) => {
  const refusals: string[] = [];
  page.on("console", (message) => {
    // Chromium words this "Executing inline script violates the following
    // Content Security Policy directive", other engines "Refused to execute".
    // Matched on the directive rather than on either verb, because the first
    // version of this test looked for "refused to execute", found nothing, and
    // failed while the policy was working perfectly.
    if (/content security policy/i.test(message.text())) refusals.push(message.text());
  });

  /* Injected into the served HTML so the parser sees it, which is the only way
   * the policy is consulted: a script added through innerHTML never runs at
   * all, and one appended by an already-trusted script is allowed on purpose by
   * 'strict-dynamic'. Neither would prove anything. */
  let injected = false;
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (!body.includes("</body>")) return route.fulfill({ response });
    injected = true;
    await route.fulfill({
      response,
      body: body.replace("</body>", '<script>window.__unauthorized=true;</script></body>'),
    });
  });

  await page.goto("/");
  await hydrated(page);

  // Asserted first and separately. Without it, "the script did not run" passes
  // just as well when the script was never put on the page, and the test
  // reports a policy it never exercised.
  expect(injected, "the unauthorized script was never injected, so nothing was tested").toBe(true);
  expect(await page.evaluate(() => "__unauthorized" in window)).toBe(false);
  expect(refusals.length, "the browser did not report refusing the script").toBeGreaterThan(0);
});
