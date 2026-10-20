// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PageError } from "../src/components/ui/base/pageerror";

/**
 * A fault offers a retry. Information this explorer cannot provide, such as a
 * validator on an instance with no deployment manifest, is stated plainly:
 * retrying cannot change the answer, and a red alert would read as breakage.
 */
describe("PageError", () => {
  it("offers a retry for a fault", () => {
    const { getByRole } = render(<PageError message="The explorer API had an internal error." />);
    expect(getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("states an unavailable answer without a retry", () => {
    const { queryByRole, getByText } = render(
      <PageError message="This information is unavailable on this explorer." retry={false} />,
    );
    expect(queryByRole("button", { name: /retry/i })).toBeNull();
    expect(getByText(/unavailable on this explorer/).className).not.toMatch(/text-danger/);
  });
});
