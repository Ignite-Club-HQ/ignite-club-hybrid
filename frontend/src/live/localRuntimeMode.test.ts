import { describe, expect, it } from "vitest";
import { resolveLocalAuthMode } from "./localRuntimeMode";

describe("live runtime mode", () => {
  it("does not enable fixture mode from public URL parameters", () => {
    expect(resolveLocalAuthMode("")).toBe(false);
    expect(resolveLocalAuthMode("?backend=icp")).toBe(false);
    expect(resolveLocalAuthMode("?backend=supabase")).toBe(false);
  });
});
