import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ dispatch: vi.fn(), save: vi.fn(), cleanup: vi.fn() }));
vi.mock("./featureRouter", () => ({ withFeatureBackend: m.dispatch }));
vi.mock("./features/notifications", () => ({ getLivePushDeliveryHealth: vi.fn(), getLivePushAlertSettings: vi.fn(), upsertLivePushAlertSettings: m.save, cleanupLiveStaleDeviceTokens: m.cleanup }));
import { adminQueueContexts, cleanupAdminDeviceTokens, saveAdminQueueSettings } from "./adminQueueOperations";
beforeEach(() => { vi.clearAllMocks(); m.dispatch.mockResolvedValue([{ target: { canisterIds: { notification_queue: "queue-a" } } }, { target: { canisterIds: { notification_queue: "queue-b" } } }]); m.cleanup.mockResolvedValue(2); m.save.mockResolvedValue({}); });
describe("complete admin queue operations", () => {
  it("requires full group coverage", async () => { await adminQueueContexts(); expect(m.dispatch).toHaveBeenCalledWith("notifications", expect.anything(), expect.objectContaining({ everyGroup: true, requireComplete: true })); });
  it("does not clean any queue after incomplete inventory", async () => { m.dispatch.mockRejectedValue(new Error("Group unavailable")); await expect(cleanupAdminDeviceTokens(90)).rejects.toThrow("Group unavailable"); expect(m.cleanup).not.toHaveBeenCalled(); });
  it("cleans both queues and sums actual removed registrations", async () => { expect(await cleanupAdminDeviceTokens(90)).toBe(4); expect(m.cleanup).toHaveBeenCalledTimes(2); expect(m.cleanup.mock.calls[1][0].target.canisterIds.notification_queue).toBe("queue-b"); });
  it("does not claim full success after a partial setting write", async () => { m.save.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Unknown")); await expect(saveAdminQueueSettings({ alertsEnabled: true, failureThresholdPercent: 20, checkWindowHours: 24, minNotifications: 10, cooldownHours: 6 })).rejects.toThrow("Saved 1 of 2 queues"); expect(m.save).toHaveBeenCalledTimes(2); });
});