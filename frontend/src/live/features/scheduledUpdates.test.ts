import { describe, expect, it, vi } from "vitest";
import type { FeatureBackendContext } from "../featureRouter";
import { updateLiveScheduledMessage } from "./notifications";

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("../domains", () => ({
  connectLiveNotificationQueue: async () => ({ actor: { update_scheduled_message: mocks.update } }),
}));
const ctx = {} as FeatureBackendContext;
// Reject after capturing arguments: these tests exercise serialization, not response rendering.
mocks.update.mockResolvedValue({ Err: "test rejection" });

describe("scheduled update options", () => {
  it("leaves omitted image and end date unchanged", async () => {
    await expect(updateLiveScheduledMessage(ctx, { id: "s", author: "owner" })).rejects.toThrow();
    expect(mocks.update.mock.lastCall?.[3]).toEqual([]);
    expect(mocks.update.mock.lastCall?.[6]).toEqual([]);
  });
  it("sends explicit image removal separately from omission", async () => {
    await expect(updateLiveScheduledMessage(ctx, { id: "s", author: "owner", imageUrl: null })).rejects.toThrow();
    expect(mocks.update.mock.lastCall?.[3]).toEqual([""]);
  });
  it("sends explicit end-date removal separately from omission", async () => {
    await expect(updateLiveScheduledMessage(ctx, { id: "s", author: "owner", recurrenceUntilMs: null })).rejects.toThrow();
    expect(mocks.update.mock.lastCall?.[6]).toEqual([0n]);
  });
  it("sends replacement image and end date", async () => {
    await expect(updateLiveScheduledMessage(ctx, { id: "s", author: "owner", imageUrl: "photo", recurrenceUntilMs: 1800000000000 })).rejects.toThrow();
    expect(mocks.update.mock.lastCall?.[3]).toEqual(["photo"]);
    expect(mocks.update.mock.lastCall?.[6]).toEqual([1800000000000n]);
  });
});