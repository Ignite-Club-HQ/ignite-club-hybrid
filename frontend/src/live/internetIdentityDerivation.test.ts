import { describe, expect, it } from "vitest";
import { resolveDerivationOriginFor } from "./internetIdentityAuth";

const ID = "proe7-kqaaa-aaaas-qg6gq-cai";

describe("Internet Identity derivation origin", () => {
  it("canister's icp0.io address signs in as itself", () => {
    expect(resolveDerivationOriginFor(`https://${ID}.icp0.io`)).toBeUndefined();
  });

  it("canister's icp.net address shares the icp0.io identity", () => {
    expect(resolveDerivationOriginFor(`https://${ID}.icp.net`)).toBe(`https://${ID}.icp0.io`);
  });

  it("canister's raw and ic0.app addresses share the icp0.io identity", () => {
    expect(resolveDerivationOriginFor(`https://${ID}.raw.icp0.io`)).toBe(`https://${ID}.icp0.io`);
    expect(resolveDerivationOriginFor(`https://${ID}.ic0.app`)).toBe(`https://${ID}.icp0.io`);
  });

  it("Lovable preview still signs in as the published Lovable site", () => {
    expect(
      resolveDerivationOriginFor("https://id-preview--9e0ff3f7-539e-4a59-aa6d-a6d3fe4c7c5e.lovable.app"),
    ).toBe("https://ignite-canister-connect.lovable.app");
  });

  it("unrelated sites are untouched", () => {
    expect(resolveDerivationOriginFor("https://example.com")).toBeUndefined();
  });
});
