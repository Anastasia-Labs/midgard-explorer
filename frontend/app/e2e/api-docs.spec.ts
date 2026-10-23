import { FIXTURE, expect, expectNoViolations, settle, test } from "./helpers";

/**
 * The page renders the backend's own OpenAPI document. So the assertion is
 * agreement with that document, fetched here from the same server the page
 * read it from, rather than a count typed into this file. The previous version
 * asserted 24 endpoints, which was a fifth copy of the API surface and would
 * have gone red on any route added correctly.
 */
test("renders exactly the endpoints the server's contract declares", async ({ page }) => {
  const document = await page.request.get(`${FIXTURE}/api/openapi.json`).then((r) => r.json());
  const declared = Object.keys(document.paths);

  await page.goto("/api-docs");
  await settle(page);

  await expect(page.getByRole("heading", { name: "API reference" })).toBeVisible();
  await expect(page.getByTestId("api-endpoint")).toHaveCount(declared.length);
  for (const path of declared) {
    await expect(page.getByText(path, { exact: true })).toBeVisible();
  }
});

test("marks a route as limited only where the contract answers 429", async ({ page }) => {
  const document = await page.request.get(`${FIXTURE}/api/openapi.json`).then((r) => r.json());
  const limited = Object.entries(document.paths).filter(
    ([, item]) => (item as { get: { responses: Record<string, unknown> } }).get.responses["429"],
  );

  await page.goto("/api-docs");
  await settle(page);
  await expect(page.getByText("Rate limited")).toHaveCount(limited.length);
});

test("links the machine-readable contract and passes an audit", async ({ page }) => {
  await page.goto("/api-docs");
  await settle(page);
  await expect(page.getByRole("link", { name: /OpenAPI JSON/ })).toHaveAttribute(
    "href",
    /\/api\/openapi\.json$/,
  );
  await expectNoViolations(page, "API reference");
});

/** The contract can be unreachable. Saying so beats an empty page that looks
 * like an API with no endpoints. */
test("says the contract is unavailable rather than showing an empty API", async ({ page }) => {
  await page.request.post(`${FIXTURE}/__control?fail=openapi&slow=0`);
  try {
    await page.goto("/api-docs");
    await settle(page);
    await expect(page.getByText(/endpoint list could not be loaded/i)).toBeVisible();
    await expect(page.getByTestId("api-endpoint")).toHaveCount(0);
  } finally {
    await page.request.post(`${FIXTURE}/__control?fail=&slow=0`);
  }
});
