import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../src/lib/contentSecurityPolicy";

describe("contentSecurityPolicy", () => {
  it("allows only nonce-bearing inline scripts in production", () => {
    const policy = contentSecurityPolicy("request-nonce", false);
    expect(policy).toContain("script-src 'self' 'nonce-request-nonce' 'strict-dynamic'");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("adds the development evaluator without weakening inline scripts", () => {
    const policy = contentSecurityPolicy("dev-nonce", true);
    expect(policy).toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});
