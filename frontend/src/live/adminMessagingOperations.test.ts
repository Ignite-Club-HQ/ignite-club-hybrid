import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ dispatch: vi.fn(), get: vi.fn(), set: vi.fn(), run: vi.fn() }));
vi.mock("./featureRouter", () => ({ withFeatureBackend: m.dispatch }));
vi.mock("./features/messaging", () => ({ getLiveChatPhotoReminderSettings: m.get, setLiveChatPhotoReminderSettings: m.set, runLiveChatPhotoGalleryReminders: m.run }));
import { runAdminPhotoReminders, saveAdminPhotoReminderSettings } from "./adminMessagingOperations";
const contexts = ["g1", "g2", "g3"].map(id => ({ target: { host: "https://icp-api.io", networkKind: "public_mainnet", canisterIds: { messaging_domain: id } } }));
const policy = { enabled: true, window_start_hours: 24, window_end_hours: 48, cooldown_days: 7 };
beforeEach(() => {
  vi.clearAllMocks(); m.dispatch.mockImplementation(async (_feature, _providers, scope) => { expect(scope.requireComplete).toBe(true); return scope.merge(contexts.map(ctx => [ctx])); });
  m.get.mockResolvedValue(policy); m.set.mockResolvedValue(undefined); m.run.mockResolvedValue({ scanned: 3, posted: 2, skipped: 1 });
});
describe("complete all-group messaging administration", () => {
  it("saves and verifies every registered messaging service", async () => {
    expect(await saveAdminPhotoReminderSettings(policy)).toBe(3);
    expect(m.set.mock.calls.map(([ctx]) => ctx.target.canisterIds.messaging_domain)).toEqual(["g1", "g2", "g3"]);
    expect(m.get).toHaveBeenCalledTimes(3);
  });
  it("does not begin writes after an incomplete inventory", async () => {
    m.dispatch.mockRejectedValue(new Error("inventory incomplete"));
    await expect(runAdminPhotoReminders(policy)).rejects.toThrow("inventory incomplete");
    expect(m.run).not.toHaveBeenCalled();
  });
  it("stops after an unknown result and retains acknowledged queued totals", async () => {
    m.run.mockResolvedValueOnce({ scanned: 3, posted: 2, skipped: 1 }).mockRejectedValueOnce(new Error("lost response"));
    await expect(runAdminPhotoReminders(policy)).rejects.toThrow("Queued 2 reminders on 1 of 3 services");
    expect(m.run).toHaveBeenCalledTimes(2);
  });
});