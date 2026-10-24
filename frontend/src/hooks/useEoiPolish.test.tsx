import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
const m = vi.hoisted(() => ({ invoke: vi.fn(), queue: vi.fn().mockResolvedValue({}) }));
vi.mock("@/live/features/competitions", () => ({ resendLiveEoiInvite: m.queue }));
vi.mock("@/live/competitionRouting", () => ({ writeEoiInScope: (_ctx: unknown, _id: string, callback: (ctx: object) => unknown) => callback({}) }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => "icp" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: m.invoke } } }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: string, handlers: { icp: () => Promise<unknown> }) => handlers.icp() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
import { useResendEoiInvite, useBulkResendEoiInvites } from "./useEoiPolish";
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>;
describe("ICP EOI delivery isolation", () => {
  it("queues single resend without calling Supabase delivery", async () => {
    m.invoke.mockClear();
    const { result } = renderHook(() => useResendEoiInvite(), { wrapper });
    await act(async () => { await result.current.mutateAsync("icp-eoi"); });
    expect(m.queue).toHaveBeenCalledWith(undefined, "icp-eoi");
    expect(m.invoke).not.toHaveBeenCalled();
  });
  it("queues bulk resend without sending ICP IDs to Supabase", async () => {
    m.invoke.mockClear();
    const { result } = renderHook(() => useBulkResendEoiInvites(), { wrapper });
    await act(async () => { expect(await result.current.mutateAsync(["icp-eoi-1", "icp-eoi-2"])).toEqual({ ok: 2, fail: 0 }); });
    expect(m.invoke).not.toHaveBeenCalled();
  });
});