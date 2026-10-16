import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { channel, removeChannel, from, getUser, invalidateQueries, toastSuccess, toastError, channels, queryOptions, mode } = vi.hoisted(() => ({
  channel: vi.fn(), removeChannel: vi.fn(), from: vi.fn(), getUser: vi.fn(), invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(), toastError: vi.fn(), channels: new Map<string, any>(),
  queryOptions: { current: null as any },
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { channel, removeChannel, from, auth: { getUser } },
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useQuery: (options: any) => {
    queryOptions.current = options;
    return { data: null, isLoading: false };
  },
  useMutation: (options: any) => ({
    isPending: false,
    mutate: async (input: any) => {
      try {
        const result = await options.mutationFn(input);
        options.onSuccess?.(result);
        return result;
      } catch (error) {
        options.onError?.(error);
      }
    },
  }),
}));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => mode === "icp" }));

import { pinnedVaultKey, useChatPinnedVault } from "./useChatPinnedVault";

function makeChannel(name: string) {
  const record: any = { name };
  record.on = vi.fn((_event: string, config: any, handler: () => void) => {
    record.config = config;
    record.handler = handler;
    return record;
  });
  record.subscribe = vi.fn(() => record);
  channels.set(name, record);
  return record;
}

function mutationChain(error: unknown = null) {
  const chain: any = {};
  chain.upsert = vi.fn().mockResolvedValue({ error });
  chain.update = vi.fn(() => chain);
  chain.delete = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  Object.defineProperty(chain, "then", {
    value: (resolve: (value: unknown) => unknown) => Promise.resolve({ error }).then(resolve),
  });
  return chain;
}

describe("useChatPinnedVault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channels.clear();
    channel.mockImplementation(makeChannel);
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("does not subscribe without a chat id or when explicitly disabled", () => {
    renderHook(() => useChatPinnedVault("team", undefined));
    renderHook(() => useChatPinnedVault("club", "club-1", { enabled: false }));
    expect(channel).not.toHaveBeenCalled();
  });

  it.runIf(mode === "supabase")("subscribes to the exact chat and invalidates only its pinned-vault key", () => {
    renderHook(() => useChatPinnedVault("group", "group-1"));
    const record = channels.get("chat-pinned-vault-group-group-1");

    expect(record.config).toEqual({
      event: "*", schema: "public", table: "chat_pinned_vault", filter: "chat_id=eq.group-1",
    });
    act(() => record.handler());
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: pinnedVaultKey("group", "group-1") });
  });

  it.runIf(mode === "supabase")("removes the old channel before subscribing to a different chat", () => {
    const { rerender } = renderHook(({ chatType, chatId }) => useChatPinnedVault(chatType, chatId), {
      initialProps: { chatType: "team" as const, chatId: "team-1" },
    });
    const old = channels.get("chat-pinned-vault-team-team-1");
    rerender({ chatType: "team", chatId: "team-2" });

    expect(removeChannel).toHaveBeenCalledWith(old);
    expect(channels.has("chat-pinned-vault-team-team-2")).toBe(true);
  });

  it.runIf(mode === "supabase")("removes the active channel on unmount", () => {
    const { unmount } = renderHook(() => useChatPinnedVault("club", "club-1"));
    const active = channels.get("chat-pinned-vault-club-club-1");
    unmount();
    expect(removeChannel).toHaveBeenCalledWith(active);
  });

  it.runIf(mode === "supabase")("saves an authenticated pinned target with exact chat scope and setter identity", async () => {
    const query = mutationChain();
    from.mockReturnValueOnce(query);
    const { result } = renderHook(() => useChatPinnedVault("team", "team-1"));

    await act(async () => result.current.save({ vault_folder_id: "folder-1", root_scope: "team", root_id: "team-1", enabled: true }));

    expect(from).toHaveBeenCalledWith("chat_pinned_vault");
    expect(query.upsert).toHaveBeenCalledWith({
      chat_type: "team", chat_id: "team-1", vault_file_id: null, vault_folder_id: "folder-1",
      root_scope: "team", root_id: "team-1", enabled: true, set_by: "user-1",
    }, { onConflict: "chat_type,chat_id" });
    expect(toastSuccess).toHaveBeenCalledWith("Pinned vault updated");
  });

  it.runIf(mode === "supabase")("rejects saving when there is no authenticated user without writing", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { result } = renderHook(() => useChatPinnedVault("team", "team-1"));
    await act(async () => result.current.save({ enabled: true }));

    expect(from).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Couldn't pin vault", { description: "Not authenticated" });
  });

  it.runIf(mode === "supabase")("scopes enable toggles by both chat type and chat id", async () => {
    const query = mutationChain();
    from.mockReturnValueOnce(query);
    const { result } = renderHook(() => useChatPinnedVault("group", "group-1"));
    await act(async () => result.current.toggleEnabled(false));

    expect(query.update).toHaveBeenCalledWith({ enabled: false });
    expect(query.eq).toHaveBeenNthCalledWith(1, "chat_type", "group");
    expect(query.eq).toHaveBeenNthCalledWith(2, "chat_id", "group-1");
  });

  it.runIf(mode === "supabase")("scopes removal by both chat type and chat id and reports mutation errors", async () => {
    const query = mutationChain({ message: "denied" });
    from.mockReturnValueOnce(query);
    const { result } = renderHook(() => useChatPinnedVault("club", "club-1"));
    await act(async () => result.current.remove());

    expect(query.delete).toHaveBeenCalledOnce();
    expect(query.eq).toHaveBeenNthCalledWith(1, "chat_type", "club");
    expect(query.eq).toHaveBeenNthCalledWith(2, "chat_id", "club-1");
    expect(toastError).toHaveBeenCalledWith("Couldn't remove pinned vault", { description: "denied" });
    expect(toastSuccess).not.toHaveBeenCalledWith("Pinned vault removed");
  });

  it.runIf(mode === "icp")("does not query or subscribe to Supabase and rejects unsupported pin mutations", async () => {
    const { result } = renderHook(() => useChatPinnedVault("team", "team-1"));
    expect(queryOptions.current.enabled).toBe(false);
    expect(channel).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();

    await act(async () => result.current.save({ enabled: true }));
    expect(toastError).toHaveBeenCalledWith("Couldn't pin vault", { description: "Pinning a vault is not yet available for Internet Identity accounts." });
    expect(from).not.toHaveBeenCalled();
  });
});
