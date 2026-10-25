import { beforeEach, describe, expect, it, vi } from "vitest";
import { importIcpFixtureOnce } from "./fixtureImportProgress";
import type { FeatureBackendContext } from "@/live/featureRouter";
import { buildLiveFixtureEventInput } from "./fixtureLiveEventMapping";
const ctx = { identity: { getPrincipal: () => ({ toText: () => "caller" }) }, target: { host: "https://icp-api.io", networkKind: "mainnet", canisterIds: { events_domain: "events" } } } as unknown as FeatureBackendContext;
const input = buildLiveFixtureEventInput({ title: "Game", date: "2027-01-01", time: "10:00" }, "club", "team");
beforeEach(() => localStorage.clear());
describe("durable fixture import receipts", () => {
  it("skips acknowledged rows on a second import", async () => {
    const create = vi.fn(async () => ["event"]);
    expect(await importIcpFixtureOnce(ctx, input, 24, create)).toEqual(["event"]);
    expect(await importIcpFixtureOnce(ctx, input, 24, create)).toEqual(["event"]);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("does not replay an unknown write", async () => {
    const create = vi.fn().mockRejectedValue(new Error("connection lost"));
    await expect(importIcpFixtureOnce(ctx, input, null, create)).rejects.toThrow("unconfirmed");
    await expect(importIcpFixtureOnce(ctx, input, null, create)).rejects.toThrow("unconfirmed");
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("never sends when durable progress cannot be stored", async () => {
    const create = vi.fn();
    const store = { getItem: () => null, setItem: () => { throw new Error("disk full"); } };
    await expect(importIcpFixtureOnce(ctx, input, null, create, store)).rejects.toThrow("disk full");
    expect(create).not.toHaveBeenCalled();
  });
});