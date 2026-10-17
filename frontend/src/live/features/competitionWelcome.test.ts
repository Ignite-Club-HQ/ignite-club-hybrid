import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ connect: vi.fn(), get: vi.fn(), set: vi.fn() }));
vi.mock("../domains", () => ({ connectLiveCompetitionDomain: m.connect }));
import { getLiveCompetitionWelcomeEmail, setLiveCompetitionWelcomeEmail } from "./competitions";
import type { FeatureBackendContext } from "../featureRouter";
const ctx = { target: { alias: "test" }, identity: {} } as FeatureBackendContext;
const settings = { competition_id: "competition-1", enabled: true, subject: "Welcome!", message: "See you soon." };
beforeEach(() => {
  vi.clearAllMocks();
  m.connect.mockResolvedValue({ actor: { get_competition_welcome_email: m.get, set_competition_welcome_email: m.set } });
});
describe("competition welcome canister adapter", () => {
  it("reads authoritative settings through the signed-in actor", async () => {
    m.get.mockResolvedValue({ Ok: settings });
    expect(await getLiveCompetitionWelcomeEmail(ctx, "competition-1")).toEqual(settings);
    expect(m.connect).toHaveBeenCalledWith(ctx.target, ctx.identity);
    expect(m.get).toHaveBeenCalledWith("competition-1");
  });
  it("saves the competition ID and exact settings without recipient data", async () => {
    m.set.mockResolvedValue({ Ok: settings });
    expect(await setLiveCompetitionWelcomeEmail(ctx, "competition-1", settings)).toEqual(settings);
    expect(m.set).toHaveBeenCalledWith("competition-1", true, "Welcome!", "See you soon.");
  });
  it("surfaces denied reads", async () => {
    m.get.mockResolvedValue({ Err: "Competition management forbidden" });
    await expect(getLiveCompetitionWelcomeEmail(ctx, "competition-1")).rejects.toThrow("Competition management forbidden");
  });
  it("surfaces rejected writes instead of reporting a saved setting", async () => {
    m.set.mockResolvedValue({ Err: "Message cannot exceed 4000 characters" });
    await expect(setLiveCompetitionWelcomeEmail(ctx, "competition-1", settings)).rejects.toThrow("Message cannot exceed 4000 characters");
  });
});