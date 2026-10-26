import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureBackendContext } from "../featureRouter";
import { maybeSendLiveMemberWelcomeEmail, saveLiveContactEmail } from "./memberWelcomeEmail";

const m = vi.hoisted(() => ({
  getSettings: vi.fn(),
  registerJob: vi.fn(),
  resolvePii: vi.fn(),
  invoke: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock("./competitions", () => ({
  getLiveCompetitionWelcomeEmail: m.getSettings,
  registerLiveMemberWelcomeJob: m.registerJob,
}));
vi.mock("./vault", () => ({
  registerLivePiiText: vi.fn(),
  resolveLivePiiTextBatch: m.resolvePii,
}));
vi.mock("../privateProfileNames", () => ({ preparePrivateOwnProfileEmail: m.prepare }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: m.invoke } },
}));

const PRINCIPAL = "aaaaa-bbbbb-ccccc-ddddd-eee";
const ctx = {
  identity: { getPrincipal: () => ({ toText: () => PRINCIPAL }) },
} as unknown as FeatureBackendContext;

describe("maybeSendLiveMemberWelcomeEmail", () => {
  beforeEach(() => {
    m.getSettings.mockReset();
    m.registerJob.mockReset();
    m.resolvePii.mockReset();
    m.invoke.mockReset();
    m.getSettings.mockResolvedValue({ enabled: true, subject: "Welcome", message: "Hi" });
    m.resolvePii.mockResolvedValue(new Map([[PRINCIPAL, "coach@example.com"]]));
    m.registerJob.mockResolvedValue({ Ok: null });
    m.invoke.mockResolvedValue({ error: null });
  });

  it("registers an on-chain delivery job without Supabase when enabled", async () => {
    await maybeSendLiveMemberWelcomeEmail(ctx, "cmp-1");
    expect(m.registerJob).toHaveBeenCalledWith(ctx, "cmp-1", expect.any(String), "coach@example.com");
    expect(m.invoke).not.toHaveBeenCalled();
  });

  it("does nothing when the competition welcome email is disabled", async () => {
    m.getSettings.mockResolvedValue({ enabled: false });
    await maybeSendLiveMemberWelcomeEmail(ctx, "cmp-1");
    expect(m.registerJob).not.toHaveBeenCalled();
    expect(m.invoke).not.toHaveBeenCalled();
  });

  it("does nothing when the member has no contact email on file", async () => {
    m.resolvePii.mockResolvedValue(new Map());
    await maybeSendLiveMemberWelcomeEmail(ctx, "cmp-1");
    expect(m.registerJob).not.toHaveBeenCalled();
    expect(m.invoke).not.toHaveBeenCalled();
  });

  it("never throws when the canister refuses the job", async () => {
    m.registerJob.mockRejectedValue(new Error("Welcome email already registered"));
    await expect(maybeSendLiveMemberWelcomeEmail(ctx, "cmp-1")).resolves.toBeUndefined();
    expect(m.invoke).not.toHaveBeenCalled();
  });
});

describe("private contact email save",()=>{
  beforeEach(()=>m.prepare.mockReset());
  it("uses the strict original-field preparer for saving and explicit clearing",async()=>{
    await saveLiveContactEmail(ctx,"coach@example.test");
    await saveLiveContactEmail(ctx,"");
    expect(m.prepare).toHaveBeenNthCalledWith(1,ctx,"coach@example.test");
    expect(m.prepare).toHaveBeenNthCalledWith(2,ctx,"");
  });
  it("does not report a failed private write as a successful profile save",async()=>{
    m.prepare.mockRejectedValue(new Error("Private readback unconfirmed"));
    await expect(saveLiveContactEmail(ctx,"coach@example.test")).rejects.toThrow("readback unconfirmed");
    expect(m.prepare).toHaveBeenCalledOnce();
  });
});
