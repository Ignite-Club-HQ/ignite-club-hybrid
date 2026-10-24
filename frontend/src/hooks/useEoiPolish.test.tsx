import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: m.invoke } } }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: string, handlers: { icp: () => Promise<unknown> }) => handlers.icp() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
import { useResendEoiInvite, useBulkResendEoiInvites } from "./useEoiPolish";
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>;
describe("ICP EOI delivery isolation", () => {
  it("refuses single resend without calling Supabase delivery", async () => {
    m.invoke.mockClear();
    const { result } = renderHook(() => useResendEoiInvite(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync("icp-eoi")).rejects.toThrow("no email was sent"); });
    expect(m.invoke).not.toHaveBeenCalled();
  });
  it("refuses bulk resend without sending ICP IDs to Supabase", async () => {
    m.invoke.mockClear();
    const { result } = renderHook(() => useBulkResendEoiInvites(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync(["icp-eoi-1", "icp-eoi-2"])).rejects.toThrow("no email was sent"); });
    expect(m.invoke).not.toHaveBeenCalled();
  });
});