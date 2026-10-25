import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ icp: true }));
const sdk = vi.hoisted(() => ({ channel: vi.fn(), options: undefined as unknown }));
vi.mock("@supabase/supabase-js", () => ({ createClient: (_url: string, _key: string, options: unknown) => {
  sdk.options = options; return { channel: sdk.channel };
} }));
vi.mock("@/live/targetRegistry", () => ({ getActiveSupabaseTarget: () => ({ url: "https://project.supabase.co", anonKey: "public" }) }));
vi.mock("@/live/strictIcpTransport", () => ({
  strictIcpActive: () => state.icp,
  reportBlockedFallback: () => new Error("ICP fallback blocked"),
  assertStrictIcpRequest: vi.fn(),
}));
import { supabase } from "./liveClient";
describe("Supabase client strict realtime boundary", () => {
  it("refuses ICP realtime subscriptions without constructing a channel", () => {
    expect(() => supabase.channel("room")).toThrow("ICP fallback blocked");
    expect(sdk.channel).not.toHaveBeenCalled();
  });
  it("preserves Supabase-mode subscriptions and installs a guarded fetch", () => {
    state.icp = false;
    supabase.channel("room");
    expect(sdk.channel).toHaveBeenCalledWith("room");
    expect(sdk.options).toEqual({ global: { fetch: expect.any(Function) } });
  });
});