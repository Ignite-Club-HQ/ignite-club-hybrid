import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ backend: "supabase", invoke: vi.fn(), from: vi.fn(), route: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke }, from: mocks.from } }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: async (feature: string, handlers: Record<string, () => Promise<void>>, scope: unknown) => {
  mocks.route(feature, scope);
  return handlers[mocks.backend]();
} }));
import { sendCompetitionWelcomeEmail } from "./sendCompetitionWelcomeEmail";
const options = { userId: "user-a", teamId: "team-a", teamName: "Team A", clubId: "club-a", clubName: "Club A", roleName: "Coach" };
beforeEach(() => { vi.clearAllMocks(); mocks.backend = "supabase"; mocks.invoke.mockResolvedValue({ error: null }); });
describe("competition welcome routing", () => {
  it("never reads Supabase or sends an auth-user email for an ICP club", async () => {
    mocks.backend = "icp";
    await sendCompetitionWelcomeEmail({ ...options, clubName: null });
    expect(mocks.route).toHaveBeenCalledWith("membership", { clubId: "club-a" });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("preserves the competition-only welcome request for a Supabase club", async () => {
    await sendCompetitionWelcomeEmail(options);
    expect(mocks.invoke).toHaveBeenCalledWith("send-email", { body: expect.objectContaining({ toUserId: "user-a", template: "team-invite", templateData: expect.objectContaining({ onlyIfCompetitionWelcome: true, teamName: "Team A" }) }) });
  });
});