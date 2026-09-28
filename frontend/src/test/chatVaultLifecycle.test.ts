import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { deliveredSend, queuedSend, isConfirmedDelivery, isQueuedAcceptance } from "@/lib/chatSendResult";

/**
 * Chat attachment → Vault lifecycle contract.
 *
 * Vault mirroring must happen ONLY for messages proven to exist server-side:
 * confirmed online inserts, errored-but-authoritatively-confirmed inserts, and
 * queued messages after the queue actually inserts them. Rejected inserts and
 * offline queue acceptance must perform zero Vault work.
 */

const SURFACES = [
  "TeamChatPage.tsx",
  "ClubChatPage.tsx",
  "GroupChatPage.tsx",
  "ClubAdminChatPage.tsx",
];

const pagesDir = join(__dirname, "..", "pages");
const read = (f: string) => readFileSync(join(pagesDir, f), "utf8");

describe("chat send delivery-state model", () => {
  it("distinguishes confirmed delivery from queued acceptance", () => {
    expect(isConfirmedDelivery(deliveredSend())).toBe(true);
    expect(isConfirmedDelivery(queuedSend())).toBe(false);
    expect(isQueuedAcceptance(queuedSend())).toBe(true);
    expect(isQueuedAcceptance(deliveredSend())).toBe(false);
  });

  it("never infers delivery from a bare resolved promise", () => {
    expect(isConfirmedDelivery(undefined)).toBe(false);
    expect(isConfirmedDelivery(null)).toBe(false);
    expect(isConfirmedDelivery({})).toBe(false);
    expect(isConfirmedDelivery({ id: "row-1" })).toBe(false);
    expect(isConfirmedDelivery("delivered")).toBe(false);
  });
});

describe("per-surface vault lifecycle wiring", () => {
  for (const file of SURFACES) {
    describe(file, () => {
      const src = read(file);

      it("no longer mirrors to the Vault from onSettled", () => {
        const idx = src.indexOf("onSettled");
        const settled = idx === -1 ? "" : src.slice(idx, idx + 2000);
        expect(settled).not.toMatch(/chatVaultSync/);
      });

      it("mirrors only on confirmed delivery", () => {
        expect(src).toMatch(/isConfirmedDelivery\([\s\S]{0,40}\)\s*\)?\s*syncSendToVault\(/);
      });

      it("marks the offline queue path as queued acceptance", () => {
        expect(src).toMatch(/queuedSend\(\)/);
      });

      it("marks the online insert path as confirmed delivery", () => {
        expect(src).toMatch(/deliveredSend\(\)/);
      });

      it("retains the Vault destination context on the queued row", () => {
        expect(src).toMatch(/vault: /);
      });

      it("treats an errored-but-authoritative send like a success", () => {
        const idx = src.indexOf("authoritativeMessageExists(");
        const branch = src.slice(idx, idx + 600);
        expect(branch).toMatch(/syncSendToVault\(variables\)/);
      });

      it("delegates Vault failures to the shared fire-and-forget boundary", () => {
        expect(src).toMatch(/surfaceLabel:/);
        expect(src).not.toMatch(/await syncSendToVault/);
      });
    });
  }

  it("does not add vault sync to Direct Message or Broadcast chat", () => {
    for (const file of ["DirectMessagePage.tsx", "BroadcastChatPage.tsx"]) {
      expect(read(file)).not.toMatch(/chatVaultSync/);
    }
  });
});

describe("offline queue vault sync", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function setup(insertError: unknown) {
    const insert = vi.fn().mockResolvedValue({ error: insertError });
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { from: vi.fn(() => ({ insert })) },
    }));
    const syncChatAttachmentToVault = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/chatVaultSync", () => ({ syncChatAttachmentToVault }));
    const queue = await import("@/lib/messageQueue");
    return { queue, syncChatAttachmentToVault, insert };
  }

  it("performs zero Vault sync while the message is only queued", async () => {
    const { queue, syncChatAttachmentToVault } = await setup(null);
    queue.queueMessage({
      type: "team",
      targetId: "team-1",
      authorId: "user-1",
      text: "see this https://reference.invalid",
      imageUrl: "https://reference.invalid",
      replyToId: null,
      createdAt: new Date().toISOString(),
      vault: { clubId: "club-1", teamId: "team-1" },
    });
    expect(syncChatAttachmentToVault).not.toHaveBeenCalled();
  });

  it("syncs once, with the stored scope, after a confirmed queued insert", async () => {
    const { queue, syncChatAttachmentToVault } = await setup(null);
    queue.queueMessage({
      type: "group",
      targetId: "group-1",
      authorId: "user-1",
      text: "doc",
      imageUrl: "https://reference.invalid",
      replyToId: null,
      createdAt: new Date().toISOString(),
      vault: {
        clubId: "club-1",
        teamId: null,
        chatGroupId: "group-1",
        chatGroupName: "Grounds",
        chatGroupAllowedRoles: ["committee_member"],
      },
    });

    const result = await queue.syncQueuedMessages();
    expect(result.synced).toBe(1);
    expect(syncChatAttachmentToVault).toHaveBeenCalledTimes(1);
    expect(syncChatAttachmentToVault).toHaveBeenCalledWith(
      expect.objectContaining({
        clubId: "club-1",
        chatGroupId: "group-1",
        chatGroupName: "Grounds",
        chatGroupAllowedRoles: ["committee_member"],
        userId: "user-1",
        imageUrl: "https://reference.invalid",
      }),
    );

    // Re-running the queue cannot mirror the same message twice.
    await queue.syncQueuedMessages();
    expect(syncChatAttachmentToVault).toHaveBeenCalledTimes(1);
  });

  it("performs zero Vault sync when the queued insert fails, and retries preserve the row", async () => {
    const { queue, syncChatAttachmentToVault } = await setup({ message: "boom" });
    queue.queueMessage({
      type: "club",
      targetId: "club-1",
      authorId: "user-1",
      text: "hi",
      imageUrl: "https://reference.invalid",
      replyToId: null,
      createdAt: new Date().toISOString(),
      vault: { clubId: "club-1" },
    });

    const result = await queue.syncQueuedMessages();
    expect(result.synced).toBe(0);
    expect(syncChatAttachmentToVault).not.toHaveBeenCalled();
    expect(queue.getQueuedMessages()).toHaveLength(1);
    expect(queue.getQueuedMessages()[0].retryCount).toBe(1);
  });

  it("does not sync when there is no vault scope or no content", async () => {
    const { queue, syncChatAttachmentToVault } = await setup(null);
    queue.queueMessage({
      type: "dm",
      targetId: "conv-1",
      authorId: "user-1",
      text: "hello",
      imageUrl: null,
      replyToId: null,
      createdAt: new Date().toISOString(),
    });
    await queue.syncQueuedMessages();
    expect(syncChatAttachmentToVault).not.toHaveBeenCalled();
  });
});
