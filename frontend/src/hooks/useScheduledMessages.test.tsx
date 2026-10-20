/**
 * Regression tests for useScheduledMessages — ensures the create, update, and
 * cancel mutations all reject unauthenticated invocations client-side BEFORE
 * calling the `scheduled-messages-write` Edge Function. The Edge Function
 * remains the authoritative boundary; this is defence-in-depth.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useCreateScheduledMessage,
  useUpdateScheduledMessage,
  useCancelScheduledMessage,
  useThreadScheduledMessages,
  useAllScheduledMessages,
} from "./useScheduledMessages";

const liveMocks = vi.hoisted(() => ({
  backend: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  listLiveScheduledMessages: vi.fn(),
  scheduleLiveMessage: vi.fn(),
  updateLiveScheduledMessage: vi.fn(),
  cancelLiveScheduledMessage: vi.fn(),
  context: { identity: { getPrincipal: () => ({ toText: () => "principal-1" }) }, target: {} },
}));
const supabaseMode = liveMocks.backend === "supabase";

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    liveMocks.backend === "icp" ? providers.icp(liveMocks.context) : providers.supabase(),
}));
vi.mock("@/live/features/notifications", () => ({
  listLiveScheduledMessages: (...args: unknown[]) => liveMocks.listLiveScheduledMessages(...args),
  scheduleLiveMessage: (...args: unknown[]) => liveMocks.scheduleLiveMessage(...args),
  updateLiveScheduledMessage: (...args: unknown[]) => liveMocks.updateLiveScheduledMessage(...args),
  cancelLiveScheduledMessage: (...args: unknown[]) => liveMocks.cancelLiveScheduledMessage(...args),
}));

// ---- auth mock ---------------------------------------------------------
let currentUser: { id: string } | null = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: currentUser }),
}));

// ---- supabase mock -----------------------------------------------------
const invokeSpy = vi.fn();

// Configurable per-test response for the read chain
let readResponse: { data: any; error: any } = { data: [], error: null };
const setReadResponse = (data: any, error: any = null) => {
  readResponse = { data, error };
};

// Simulated chain: `.from().select().eq().eq()...` all return the same chain
// which is thenable and resolves to `readResponse`.
function makeReadChain() {
  const chain: any = {};
  const passthroughMethods = ["select", "eq", "in", "is", "order", "not"];
  for (const m of passthroughMethods) chain[m] = () => chain;
  chain.then = (onF: any, onR: any) =>
    Promise.resolve(readResponse).then(onF, onR);
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: any[]) => invokeSpy(...args),
    },
    from: () => makeReadChain(),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  invokeSpy.mockReset();
  invokeSpy.mockResolvedValue({ data: { row: { id: "row-1" } }, error: null });
  currentUser = { id: "user-1" };
  setReadResponse([], null);
});

describe.runIf(supabaseMode)("useScheduledMessages auth guards", () => {
  describe("useUpdateScheduledMessage", () => {
    it("rejects unauthenticated updates before invoking the Edge Function", async () => {
      currentUser = null;
      const { result } = renderHook(() => useUpdateScheduledMessage(), { wrapper });
      await act(async () => {
        await expect(
          result.current.mutateAsync({ id: "id-1", text: "hi" }),
        ).rejects.toThrow(/not authenticated/i);
      });
      expect(invokeSpy).not.toHaveBeenCalled();
    });

    it("invokes the Edge Function when authenticated", async () => {
      const { result } = renderHook(() => useUpdateScheduledMessage(), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({ id: "id-1", text: "hi" });
      });
      expect(invokeSpy).toHaveBeenCalledTimes(1);
      const [name, opts] = invokeSpy.mock.calls[0];
      expect(name).toBe("scheduled-messages-write");
      expect(opts.body).toMatchObject({ action: "update", id: "id-1", text: "hi" });
    });

    it("update bodies include only explicitly supplied fields", async () => {
      const { result } = renderHook(() => useUpdateScheduledMessage(), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({ id: "id-1", text: "only text" });
      });
      const [, opts] = invokeSpy.mock.calls[0];
      expect(Object.keys(opts.body).sort()).toEqual(["action", "id", "text"].sort());
    });
  });

  describe("useCancelScheduledMessage", () => {
    it("rejects unauthenticated cancellation before invoking the Edge Function", async () => {
      currentUser = null;
      const { result } = renderHook(() => useCancelScheduledMessage(), { wrapper });
      await act(async () => {
        await expect(result.current.mutateAsync("id-1")).rejects.toThrow(
          /not authenticated/i,
        );
      });
      expect(invokeSpy).not.toHaveBeenCalled();
    });

    it("invokes the Edge Function with cancel action for the specified id", async () => {
      const { result } = renderHook(() => useCancelScheduledMessage(), { wrapper });
      await act(async () => {
        await result.current.mutateAsync("id-abc");
      });
      expect(invokeSpy).toHaveBeenCalledTimes(1);
      const [name, opts] = invokeSpy.mock.calls[0];
      expect(name).toBe("scheduled-messages-write");
      expect(opts.body).toEqual({ action: "cancel", id: "id-abc" });
    });
  });

  describe("useCreateScheduledMessage", () => {
    it("rejects unauthenticated creates before invoking the Edge Function", async () => {
      currentUser = null;
      const { result } = renderHook(() => useCreateScheduledMessage(), { wrapper });
      await act(async () => {
        await expect(
          result.current.mutateAsync({
            chat_type: "team",
            team_id: "t1",
            text: "hi",
            scheduled_for: new Date("2026-01-01T10:00:00Z"),
          }),
        ).rejects.toThrow(/not authenticated/i);
      });
      expect(invokeSpy).not.toHaveBeenCalled();
    });

    it("invokes the Edge Function when authenticated", async () => {
      const { result } = renderHook(() => useCreateScheduledMessage(), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({
          chat_type: "team",
          team_id: "t1",
          text: "hi",
          scheduled_for: new Date("2026-01-01T10:00:00Z"),
        });
      });
      expect(invokeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("failure semantics", () => {
    it("failed writes do not invalidate caches", async () => {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
      const localWrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      );
      invokeSpy.mockResolvedValueOnce({
        data: null,
        error: { message: "boom", context: null },
      });
      const { result } = renderHook(() => useCancelScheduledMessage(), {
        wrapper: localWrapper,
      });
      await act(async () => {
        await expect(result.current.mutateAsync("id-1")).rejects.toThrow();
      });
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it("successful writes invalidate both scheduled-message cache groups", async () => {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
      const localWrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(() => useCancelScheduledMessage(), {
        wrapper: localWrapper,
      });
      await act(async () => {
        await result.current.mutateAsync("id-1");
      });
      const keys = invalidateSpy.mock.calls.map((c) => (c[0] as any).queryKey?.[0]);
      expect(keys).toContain("scheduled-messages-thread");
      expect(keys).toContain("scheduled-messages-all");
    });

    it("pro-required errors retain the machine-readable code", async () => {
      invokeSpy.mockResolvedValueOnce({
        data: null,
        error: {
          message: "pro required",
          context: {
            json: async () => ({ error: "pro_required" }),
          },
        },
      });
      const { result } = renderHook(() => useCancelScheduledMessage(), { wrapper });
      await act(async () => {
        await expect(result.current.mutateAsync("id-1")).rejects.toMatchObject({
          code: "pro_required",
        });
      });
    });

    it("session-expiry errors tag the thrown error with code=session_expired", async () => {
      invokeSpy.mockResolvedValueOnce({
        data: null,
        error: {
          message: "Unauthorized",
          context: { status: 401, json: async () => ({ error: "not authenticated" }) },
        },
      });
      const { result } = renderHook(() => useCancelScheduledMessage(), { wrapper });
      await act(async () => {
        await expect(result.current.mutateAsync("id-1")).rejects.toMatchObject({
          code: "session_expired",
        });
      });
    });
  });

  describe("read query semantics", () => {
    it("thread query returns [] when no rows exist", async () => {
      setReadResponse([], null);
      const { result } = renderHook(
        () => useThreadScheduledMessages({ chat_type: "team", team_id: "t1" }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });

    it("thread query rejects rather than returning [] on error", async () => {
      setReadResponse(null, { message: "boom" });
      const { result } = renderHook(
        () => useThreadScheduledMessages({ chat_type: "team", team_id: "t1" }),
        { wrapper },
      );
      // The hook retries 3x with exponential backoff before surfacing an
      // error, so allow for the full backoff chain here.
      await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15000 });
      expect(result.current.data).toBeUndefined();
    }, 20000);

    it("all-message query returns [] when no rows exist", async () => {
      setReadResponse([], null);
      const { result } = renderHook(() => useAllScheduledMessages(["pending"]), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });

    it("all-message query rejects on error rather than returning []", async () => {
      setReadResponse(null, { message: "boom" });
      const { result } = renderHook(() => useAllScheduledMessages(["pending"]), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15000 });
      expect(result.current.data).toBeUndefined();
    }, 20000);

    it("failed refetch preserves previous successful data (keepPreviousData)", async () => {
      // Prime with a successful load, then flip to an error and refetch.
      const initialRow = { id: "r-1", scheduled_for: "2030-01-01T00:00:00Z" };
      setReadResponse([initialRow], null);
      const { result } = renderHook(() => useAllScheduledMessages(["pending"]), {
        wrapper,
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([initialRow]);

      setReadResponse(null, { message: "network down" });
      await act(async () => {
        await result.current.refetch();
      });
      // The refetch itself retries 3x with exponential backoff before the
      // query settles into an error state — allow for the full chain.
      await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15000 });
      // Previous data must remain visible so the UI does not blank the list.
      expect(result.current.data).toEqual([initialRow]);
    }, 20000);
  });
});

describe.runIf(!supabaseMode)("useScheduledMessages ICP adapters", () => {
  const rawScheduledMessage = {
    id: "scheduled-1",
    author: "principal-1",
    chatType: "team",
    teamId: "team-1",
    clubId: null,
    groupId: null,
    conversationId: null,
    body: "Practice moved",
    imageUrl: null,
    replyToId: null,
    scheduledForMs: 1_800_000_000_000,
    status: "pending",
    sentMessageId: null,
    errorMessage: null,
    attemptedAtMs: null,
    recurrence: "none",
    recurrenceUntilMs: null,
    recurrenceParentId: null,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
  };

  beforeEach(() => {
    liveMocks.backend = "icp";
    liveMocks.listLiveScheduledMessages.mockReset().mockResolvedValue([rawScheduledMessage]);
    liveMocks.scheduleLiveMessage.mockReset().mockResolvedValue(rawScheduledMessage);
    liveMocks.updateLiveScheduledMessage.mockReset().mockResolvedValue(rawScheduledMessage);
    liveMocks.cancelLiveScheduledMessage.mockReset().mockResolvedValue(undefined);
    invokeSpy.mockReset();
  });

  it("maps and filters pending thread messages from the canister", async () => {
    const { result } = renderHook(
      () => useThreadScheduledMessages({ chat_type: "team", team_id: "team-1" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data?.[0]).toMatchObject({
      id: "scheduled-1",
      author_id: "principal-1",
      chat_type: "team",
      team_id: "team-1",
      text: "Practice moved",
      scheduled_for: new Date(rawScheduledMessage.scheduledForMs).toISOString(),
    }));
    expect(liveMocks.listLiveScheduledMessages).toHaveBeenCalledWith(liveMocks.context, "principal-1");
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("filters all canister messages by requested status and sorts by schedule time", async () => {
    liveMocks.listLiveScheduledMessages.mockResolvedValue([
      rawScheduledMessage,
      { ...rawScheduledMessage, id: "sent-1", status: "sent", scheduledForMs: 1_700_000_000_000 },
      { ...rawScheduledMessage, id: "cancelled-1", status: "cancelled", scheduledForMs: 1_600_000_000_000 },
    ]);
    const { result } = renderHook(() => useAllScheduledMessages(["pending", "sent"]), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.map((row) => row.id)).toEqual(["sent-1", "scheduled-1"]);
    expect(liveMocks.listLiveScheduledMessages).toHaveBeenCalledWith(liveMocks.context, "principal-1");
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("creates, updates, and cancels through the notifications canister", async () => {
    const { result: create } = renderHook(() => useCreateScheduledMessage(), { wrapper });
    await act(async () => create.current.mutateAsync({
      chat_type: "team",
      team_id: "team-1",
      text: "Practice moved",
      scheduled_for: new Date(rawScheduledMessage.scheduledForMs),
    }));
    expect(liveMocks.scheduleLiveMessage).toHaveBeenCalledWith(liveMocks.context, expect.objectContaining({
      author: "principal-1",
      chatType: "team",
      teamId: "team-1",
      body: "Practice moved",
      scheduledForMs: rawScheduledMessage.scheduledForMs,
    }));

    const { result: update } = renderHook(() => useUpdateScheduledMessage(), { wrapper });
    await act(async () => update.current.mutateAsync({ id: "scheduled-1", text: "Updated" }));
    expect(liveMocks.updateLiveScheduledMessage).toHaveBeenCalledWith(liveMocks.context, expect.objectContaining({
      id: "scheduled-1",
      author: "principal-1",
      body: "Updated",
    }));

    const { result: cancel } = renderHook(() => useCancelScheduledMessage(), { wrapper });
    await act(async () => cancel.current.mutateAsync("scheduled-1"));
    expect(liveMocks.cancelLiveScheduledMessage).toHaveBeenCalledWith(liveMocks.context, "scheduled-1", "principal-1");
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("keeps scheduled photo and reply references in the canister write", async () => {
    const { result } = renderHook(() => useCreateScheduledMessage(), { wrapper });
    await act(async () => result.current.mutateAsync({
      chat_type: "team", team_id: "team-1", text: "",
      image_url: "https://photos.example/scheduled-photo", reply_to_id: "reply-1",
      scheduled_for: new Date(rawScheduledMessage.scheduledForMs), recurrence: "weekly",
    }));
    expect(liveMocks.scheduleLiveMessage).toHaveBeenCalledWith(liveMocks.context, expect.objectContaining({
      body: "", imageUrl: "https://photos.example/scheduled-photo", replyToId: "reply-1", recurrence: "weekly",
    }));
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("preserves explicit image and recurrence-end removal through the ICP adapter", async () => {
    const { result } = renderHook(() => useUpdateScheduledMessage(), { wrapper });
    await act(async () => result.current.mutateAsync({ id: "scheduled-1", image_url: null, recurrence_until: null }));
    expect(liveMocks.updateLiveScheduledMessage).toHaveBeenCalledWith(liveMocks.context, expect.objectContaining({
      imageUrl: null, recurrenceUntilMs: null,
    }));
  });

  it("rejects signed-out writes before contacting either backend", async () => {
    currentUser = null;
    const { result } = renderHook(() => useCancelScheduledMessage(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync("scheduled-1")).rejects.toThrow("Not authenticated");
    });
    expect(liveMocks.cancelLiveScheduledMessage).not.toHaveBeenCalled();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("surfaces a canister write rejection without invalidating saved-message caches", async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    liveMocks.cancelLiveScheduledMessage.mockRejectedValue(new Error("Author mismatch"));
    const { result } = renderHook(() => useCancelScheduledMessage(), { wrapper: localWrapper });
    await act(async () => {
      await expect(result.current.mutateAsync("scheduled-1")).rejects.toThrow("Author mismatch");
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("invalidates both cache groups after successful create, update, and cancel", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const input = {
      chat_type: "team" as const,
      team_id: "team-1",
      text: "Practice moved",
      scheduled_for: new Date(rawScheduledMessage.scheduledForMs),
    };

    const { result: create } = renderHook(() => useCreateScheduledMessage(), { wrapper: localWrapper });
    await act(async () => create.current.mutateAsync(input));
    const { result: update } = renderHook(() => useUpdateScheduledMessage(), { wrapper: localWrapper });
    await act(async () => update.current.mutateAsync({ id: "scheduled-1", text: "Updated" }));
    const { result: cancel } = renderHook(() => useCancelScheduledMessage(), { wrapper: localWrapper });
    await act(async () => cancel.current.mutateAsync("scheduled-1"));

    const keys = invalidate.mock.calls.map((call) => (call[0] as { queryKey: string[] }).queryKey[0]);
    expect(keys.filter((key) => key === "scheduled-messages-thread")).toHaveLength(3);
    expect(keys.filter((key) => key === "scheduled-messages-all")).toHaveLength(3);
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});
