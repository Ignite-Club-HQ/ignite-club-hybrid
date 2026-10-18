import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureBackendContext } from "./featureRouter";
import { registerLiveCompetitionWelcomeJob } from "./features/competitions";

const m = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("./domains", () => ({
  connectLiveCompetitionDomain: async () => ({ actor: { register_competition_welcome_job: m.register } }),
}));

const ctx = {} as FeatureBackendContext;

describe("competition welcome email job registration", () => {
  beforeEach(() => m.register.mockReset());

  it("registers the recipient against the invite token", async () => {
    m.register.mockResolvedValue({ Ok: null });
    await registerLiveCompetitionWelcomeJob(ctx, "token-abc", "ref@example.com");
    expect(m.register).toHaveBeenCalledWith("token-abc", "ref@example.com");
  });

  it("propagates the canister refusal when welcome emails are disabled", async () => {
    m.register.mockResolvedValue({ Err: "Welcome email is not enabled for this competition" });
    await expect(registerLiveCompetitionWelcomeJob(ctx, "token-abc", "ref@example.com"))
      .rejects.toThrow("Welcome email is not enabled for this competition");
  });

  it("propagates a management-authorization denial", async () => {
    m.register.mockResolvedValue({ Err: "Competition management forbidden" });
    await expect(registerLiveCompetitionWelcomeJob(ctx, "token-abc", "ref@example.com"))
      .rejects.toThrow("Competition management forbidden");
  });
});
