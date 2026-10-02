import { describe, expect, it, vi } from "vitest";

vi.mock("./authBackendMode", () => ({
  resolveAuthBackend: vi.fn(() => "supabase"),
}));

import { resolveAuthBackend } from "./authBackendMode";
import { resolveLocalAuthMode } from "./localRuntimeMode";

const mockedResolveAuthBackend = vi.mocked(resolveAuthBackend);

describe("live runtime mode", () => {
  it("does not enable the ICP branch from public URL parameters", () => {
    expect(resolveLocalAuthMode("")).toBe(false);
    expect(resolveLocalAuthMode("?backend=icp")).toBe(false);
    expect(resolveLocalAuthMode("?backend=supabase")).toBe(false);
  });

  it("follows the placement-settings backend routing", () => {
    mockedResolveAuthBackend.mockReturnValue("icp");
    expect(resolveLocalAuthMode("")).toBe(true);
    // Even when ICP is active, a URL parameter is not the authority.
    expect(resolveLocalAuthMode("?backend=supabase")).toBe(true);
    mockedResolveAuthBackend.mockReturnValue("supabase");
    expect(resolveLocalAuthMode("")).toBe(false);
  });
});
