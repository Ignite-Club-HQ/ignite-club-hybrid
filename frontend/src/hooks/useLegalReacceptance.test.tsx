import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userId: "user-a" as string | null,
  setting: null as unknown,
  settingError: null as unknown,
  acceptances: new Map<string, { terms_accepted_at: string | null; privacy_accepted_at: string | null }>(),
  reads: [] as string[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mocks.userId ? { id: mocks.userId } : null }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          mocks.reads.push(table);
          if (table === "app_settings") {
            return {
              data: mocks.setting === null ? null : { value: mocks.setting },
              error: mocks.settingError,
            };
          }
          if (table === "profiles") {
            return {
              data: mocks.userId ? mocks.acceptances.get(mocks.userId) ?? null : null,
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
  },
}));

import { useLegalReacceptance } from "./useLegalReacceptance";

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const firstActivation = {
  required: true,
  version: "2026-08-01",
  effective_at: "2026-08-01T00:00:00.000Z",
  summary: "Updated legal documents",
};

describe("useLegalReacceptance", () => {
  beforeEach(() => {
    mocks.userId = "user-a";
    mocks.setting = null;
    mocks.settingError = null;
    mocks.acceptances.clear();
    mocks.reads.length = 0;
  });

  it("defaults to off when the setting row is missing", async () => {
    const { result } = renderHook(() => useLegalReacceptance(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.setting.required).toBe(false);
    expect(result.current.mustAccept).toBe(false);
    expect(mocks.reads).not.toContain("profiles");
  });

  it.each([
    undefined,
    {},
    { required: false, effective_at: "2026-08-01T00:00:00.000Z" },
    { required: true },
    { required: "true", effective_at: "2026-08-01T00:00:00.000Z" },
  ])("fails safely to off for malformed or non-enabled value %#", async (value) => {
    mocks.setting = value;
    const { result } = renderHook(() => useLegalReacceptance(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.mustAccept).toBe(false);
    expect(mocks.reads).not.toContain("profiles");
  });

  it("requires every signed-in user whose two acceptances predate activation", async () => {
    mocks.setting = firstActivation;
    mocks.acceptances.set("user-a", {
      terms_accepted_at: "2026-07-01T00:00:00.000Z",
      privacy_accepted_at: "2026-07-01T00:00:00.000Z",
    });
    const a = renderHook(() => useLegalReacceptance(), { wrapper: wrapper() });
    await waitFor(() => expect(a.result.current.isLoading).toBe(false));
    expect(a.result.current.mustAccept).toBe(true);
    a.unmount();

    mocks.userId = "user-b";
    mocks.acceptances.set("user-b", {
      terms_accepted_at: null,
      privacy_accepted_at: null,
    });
    const b = renderHook(() => useLegalReacceptance(), { wrapper: wrapper() });
    await waitFor(() => expect(b.result.current.isLoading).toBe(false));
    expect(b.result.current.mustAccept).toBe(true);
  });

  it("does not prompt a user again once both documents were accepted after activation", async () => {
    mocks.setting = firstActivation;
    mocks.acceptances.set("user-a", {
      terms_accepted_at: "2026-08-01T00:01:00.000Z",
      privacy_accepted_at: "2026-08-01T00:01:00.000Z",
    });
    const { result } = renderHook(() => useLegalReacceptance(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.mustAccept).toBe(false);
  });

  it("requires the same user again after a separate later activation", async () => {
    mocks.acceptances.set("user-a", {
      terms_accepted_at: "2026-08-01T00:01:00.000Z",
      privacy_accepted_at: "2026-08-01T00:01:00.000Z",
    });
    mocks.setting = firstActivation;
    const first = renderHook(() => useLegalReacceptance(), { wrapper: wrapper() });
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    expect(first.result.current.mustAccept).toBe(false);
    first.unmount();

    mocks.setting = {
      required: true,
      version: "2026-09-15",
      effective_at: "2026-09-15T00:00:00.000Z",
      summary: "A later independent update",
    };
    const second = renderHook(() => useLegalReacceptance(), { wrapper: wrapper() });
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(second.result.current.mustAccept).toBe(true);
  });

  it("requires both Terms and Privacy acceptance to be current", async () => {
    mocks.setting = firstActivation;
    mocks.acceptances.set("user-a", {
      terms_accepted_at: "2026-08-01T00:01:00.000Z",
      privacy_accepted_at: "2026-07-01T00:00:00.000Z",
    });
    const { result } = renderHook(() => useLegalReacceptance(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.mustAccept).toBe(true);
  });
});
