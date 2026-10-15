import { describe, it, expect } from "vitest";
import { officialLinkProblem } from "./officialLinkStatus";

describe("officialLinkProblem", () => {
  it("explains expired links", () => expect(officialLinkProblem("expired")).toBe("This link has expired."));
  it("explains used-up links", () =>
    expect(officialLinkProblem("used_up")).toBe("This link has already been used the maximum number of times."));
  it("treats unknown tokens as missing", () =>
    expect(officialLinkProblem("invalid")).toBe("This link doesn't exist or has been turned off."));
});
