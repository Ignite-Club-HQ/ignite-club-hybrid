import { describe, expect, it, beforeEach } from "vitest";
import { clearPendingClaim, parseClaimLink, readPendingClaim, savePendingClaim } from "./accountClaim";

const T = "a".repeat(64);

describe("account claim links", () => {
  beforeEach(() => clearPendingClaim());

  it("reads the token from the fragment and the group from the query", () => {
    expect(parseClaimLink("?g=g2", `#t=${T}`)).toEqual({ token: T, group: "g2" });
  });

  it("ignores a token placed in the query string", () => {
    expect(parseClaimLink(`?g=g2&t=${T}`, "")).toBeNull();
  });

  it("rejects malformed tokens and groups", () => {
    expect(parseClaimLink("?g=g2", "#t=short")).toBeNull();
    expect(parseClaimLink("?g=../x", `#t=${T}`)).toBeNull();
  });

  it("keeps the pending claim across sign-in until cleared", () => {
    savePendingClaim({ token: T, group: "g1" });
    expect(readPendingClaim()).toEqual({ token: T, group: "g1" });
    clearPendingClaim();
    expect(readPendingClaim()).toBeNull();
  });
});
