import { describe, expect, it } from "vitest";

import { resolveLocalAuthMode } from "./localRuntimeMode";

describe("live runtime mode", () => {
  it("never enables the lab-fixture branch in the live build", () => {
    expect(resolveLocalAuthMode("")).toBe(false);
    expect(resolveLocalAuthMode("?backend=icp")).toBe(false);
    expect(resolveLocalAuthMode("?backend=supabase")).toBe(false);
    expect(resolveLocalAuthMode("?backend=icp", true)).toBe(false);
    expect(resolveLocalAuthMode("?backend=icp", false)).toBe(false);
  });
});
