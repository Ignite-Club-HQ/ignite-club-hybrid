import { describe, expect, it } from "vitest";
import { normalizeAccountId } from "./messagingCandidates";

describe("normalizeAccountId", () => {
  it("strips the club_domain 'principal:' prefix so grants resolve to real principals", () => {
    expect(normalizeAccountId("principal:tbifj-jslqb-llr2n-54yzx-waeuk-ponhi-lildr-r5kwc-kfd5q-2sqjk-sqe"))
      .toBe("tbifj-jslqb-llr2n-54yzx-waeuk-ponhi-lildr-r5kwc-kfd5q-2sqjk-sqe");
  });

  it("leaves bare principal text unchanged", () => {
    expect(normalizeAccountId("2vxsx-fae")).toBe("2vxsx-fae");
  });
});
