import { describe, expect, it, vi } from "vitest";
import type { FeatureBackendContext } from "./featureRouter";
import { exportAdminDomain } from "./adminBackupExport";
const m = vi.hoisted(() => ({ export: vi.fn(), dispose: vi.fn() }));
vi.mock("./domains", () => ({ connectLiveEventsDomain: async () => ({ actor: { export_state: m.export } }) }));
vi.mock("./identityAccess", () => ({ connectLiveIdentityAccessClientWithIdentity: async () => ({ client: { exportState: m.export, dispose: m.dispose } }) }));
describe("privileged backup exports", () => {
  it("rejects access denial instead of downloading an error as a backup", async () => {
    m.export.mockResolvedValue({ Err: "Governor only" });
    await expect(exportAdminDomain({} as FeatureBackendContext, "events_domain")).rejects.toThrow("Governor only");
  });
  it("retains complete domain data and bigint values", async () => {
    m.export.mockResolvedValue({ Ok: { events: [{ id: "event-1", start_ms: 123n }] } });
    await expect(exportAdminDomain({} as FeatureBackendContext, "events_domain")).resolves.toEqual({ events: [{ id: "event-1", start_ms: 123n }] });
  });
  it("disposes the identity export client after rejection", async () => {
    m.export.mockRejectedValue(new Error("Forbidden"));
    await expect(exportAdminDomain({} as FeatureBackendContext, "identity_access")).rejects.toThrow("Forbidden"); expect(m.dispose).toHaveBeenCalled();
  });
});