import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatVaultDeliverySync } from "./useChatVaultDeliverySync";

const syncChatAttachmentToVault = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/chatVaultSync", () => ({ syncChatAttachmentToVault }));

describe("useChatVaultDeliverySync", () => {
  beforeEach(() => syncChatAttachmentToVault.mockClear());

  it("mirrors confirmed content into the exact restricted group scope", async () => {
    const scope = {
      clubId: "club-1",
      teamId: "team-1",
      chatGroupId: "group-1",
      chatGroupName: "Grounds",
      chatGroupAllowedRoles: ["committee_member"],
    };
    const { result } = renderHook(() =>
      useChatVaultDeliverySync({ userId: "user-1", scope, surfaceLabel: "Group chat" }),
    );

    await act(async () => {
      result.current({ text: "document", imageUrl: "https://img/one.png" });
      await vi.waitFor(() => expect(syncChatAttachmentToVault).toHaveBeenCalledTimes(1));
    });

    expect(syncChatAttachmentToVault).toHaveBeenCalledWith({
      imageUrl: "https://img/one.png",
      text: "document",
      userId: "user-1",
      clubId: "club-1",
      teamId: "team-1",
      chatGroupId: "group-1",
      chatGroupName: "Grounds",
      chatGroupAllowedRoles: ["committee_member"],
      isClubAdminChat: false,
    });
  });

  it("does nothing without a user, scope, or sendable content", () => {
    const cases = [
      { userId: null, scope: { clubId: "club-1" }, content: { text: "document", imageUrl: null } },
      { userId: "user-1", scope: null, content: { text: "document", imageUrl: null } },
      { userId: "user-1", scope: { clubId: "club-1" }, content: { text: "", imageUrl: null } },
    ];
    for (const { content, ...options } of cases) {
      const { result, unmount } = renderHook(() =>
        useChatVaultDeliverySync({ ...options, surfaceLabel: "Chat" }),
      );
      act(() => result.current(content));
      unmount();
    }
    expect(syncChatAttachmentToVault).not.toHaveBeenCalled();
  });

  it("contains a rejected Vault write instead of rejecting the delivered send", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    syncChatAttachmentToVault.mockRejectedValueOnce(new Error("vault unavailable"));
    const { result } = renderHook(() =>
      useChatVaultDeliverySync({
        userId: "user-1",
        scope: { clubId: "club-1", isClubAdminChat: true },
        surfaceLabel: "Club admin chat",
      }),
    );

    act(() => result.current({ text: "document", imageUrl: null }));
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
      "Club admin chat vault sync failed",
      expect.any(Error),
    ));
  });
});
