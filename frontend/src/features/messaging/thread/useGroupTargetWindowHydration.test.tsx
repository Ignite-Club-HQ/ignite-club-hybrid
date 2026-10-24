import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ read: vi.fn(), scope: undefined as unknown }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => true }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: unknown, providers: { icp: (ctx: object) => unknown }, scope: unknown) => { mocks.scope = scope; return providers.icp({}); } }));
vi.mock("@/live/features/messaging", () => ({ getLiveMessageWindow: (...args: unknown[]) => mocks.read(...args) }));
vi.mock("@/lib/chatMessageReconciliation", () => ({ reconcileMessages: (_: unknown, rows: unknown) => rows }));
vi.mock("@/components/chat/chatVirtDebug", () => ({ debugLogEvent: vi.fn() }));
import { useGroupTargetWindowHydration } from "./useGroupTargetWindowHydration";
describe("ICP old-message jump", () => {
  it("loads an exact target outside the current page without touching Supabase", async () => {
    mocks.read.mockResolvedValue({ messages: [{ id: "older-target", conversation_id: "group-1", body: "Old poll", sender: { toText: () => "author" }, created_at_ms: 1_700_000_000_000n, reply_to_id: [], attachment: [] }], next_sequence: [1n] });
    const setRows = vi.fn(), setOlder = vi.fn(), setNonce = vi.fn(), from = vi.fn();
    renderHook(() => useGroupTargetWindowHydration({ targetMessageId: "older-target", targetJumpNonce: "tap-2", groupId: "group-1", userId: "self", clubId: "club-2", authReady: true, reconcileScope: "test", localMessagesRef: { current: [] }, setLocalMessages: setRows, setHasOlderMessages: setOlder, setJumpRenderNonce: setNonce, supabaseClient: { from, channel: vi.fn() } }));
    await waitFor(() => expect(setRows).toHaveBeenCalled());
    expect(setRows.mock.calls[0][0][0]).toMatchObject({ id: "older-target", group_id: "group-1", text: "Old poll" });
    expect(mocks.scope).toEqual({ clubId: "club-2" });
    expect(from).not.toHaveBeenCalled();
    expect(setOlder).toHaveBeenCalledWith(true);
    expect(setNonce).toHaveBeenCalledWith("tap-2");
  });
});