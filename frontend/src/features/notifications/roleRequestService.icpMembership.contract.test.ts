import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/features/notifications/roleRequestService.ts"), "utf8");

describe("roleRequestService ICP membership wiring", () => {
  it("routes approve/deny through withFeatureBackend instead of a hard Supabase-only gate", () => {
    expect(source).toContain('withFeatureBackend("membership", {');
    expect(source).not.toContain("NEEDS-CANISTER");
    expect(source).not.toContain("assertSupabaseWritePath");
  });

  it("approves via approveLiveRoleRequest when membership is ICP-routed", () => {
    expect(source).toContain("await approveLiveRoleRequest(ctx, requestId);");
  });

  it("rejects via rejectLiveRoleRequest when membership is ICP-routed", () => {
    expect(source).toContain("await rejectLiveRoleRequest(ctx, requestId);");
  });
});
