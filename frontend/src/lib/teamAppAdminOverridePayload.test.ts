import { describe, expect, it } from "vitest";
import { computeAppAdminOverride } from "./teamAppAdminOverridePayload";

describe("computeAppAdminOverride", () => {
  it("turning Pro override off also clears Pro Football override", () => {
    const result = computeAppAdminOverride(
      { admin_pro_override: false },
      { admin_pro_override: true, admin_pro_football_override: true },
    );
    expect(result).toEqual({ adminProOverride: false, adminProFootballOverride: false });
  });

  it("turning Pro override on preserves the existing Pro Football override", () => {
    const result = computeAppAdminOverride(
      { admin_pro_override: true },
      { admin_pro_override: false, admin_pro_football_override: true },
    );
    expect(result).toEqual({ adminProOverride: true, adminProFootballOverride: true });
  });

  it("turning Pro Football override on implies Pro override on", () => {
    const result = computeAppAdminOverride(
      { admin_pro_football_override: true },
      { admin_pro_override: false, admin_pro_football_override: false },
    );
    expect(result).toEqual({ adminProOverride: true, adminProFootballOverride: true });
  });

  it("turning Pro Football override off leaves the existing Pro override untouched", () => {
    const result = computeAppAdminOverride(
      { admin_pro_football_override: false },
      { admin_pro_override: true, admin_pro_football_override: true },
    );
    expect(result).toEqual({ adminProOverride: true, adminProFootballOverride: false });
  });

  it("defaults to false fields when there is no current subscription row", () => {
    const result = computeAppAdminOverride({ admin_pro_override: true }, null);
    expect(result).toEqual({ adminProOverride: true, adminProFootballOverride: false });
  });
});
