import { supabase } from "@/integrations/supabase/client";

export type QueuedMessageType = "team" | "club" | "group" | "broadcast" | "dm" | "club_admin";

/**
 * Vault destination context captured at queue time so a message delivered later
 * (after reconnect) mirrors its attachment/file links to exactly the same Vault
 * scope it would have used had it been sent online.
 */
export interface QueuedVaultContext {
  clubId: string;
  teamId?: string | null;
  chatGroupId?: string | null;
  chatGroupName?: string | null;
  chatGroupAllowedRoles?: string[] | null;
  isClubAdminChat?: boolean;
}

export interface QueuedMessage {
  id: string;
  type: QueuedMessageType;
  targetId: string; // team_id, club_id, group_id, conversation_id, etc.
  authorId: string;
  text: string;
  imageUrl: string | null;
  replyToId: string | null;
  createdAt: string;
  retryCount: number;
  /** Present only for surfaces that mirror attachments to the Vault. */
  vault?: QueuedVaultContext | null;
}

const QUEUE_KEY = "ignite_message_queue";
const MAX_RETRIES = 3;

// Get all queued messages
export function getQueuedMessages(): QueuedMessage[] {
  try {
    const stored = localStorage.getItem(QUEUE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Save queue to localStorage
function saveQueue(queue: QueuedMessage[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage might be full
    console.error("Failed to save message queue");
  }
}

// Add a message to the queue
export function queueMessage(message: Omit<QueuedMessage, "id" | "retryCount">): QueuedMessage {
  const queue = getQueuedMessages();
  const queuedMessage: QueuedMessage = {
    ...message,
    id: `queued-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    retryCount: 0,
  };
  queue.push(queuedMessage);
  saveQueue(queue);
  return queuedMessage;
}

// Remove a message from the queue
export function removeFromQueue(id: string) {
  const queue = getQueuedMessages();
  const filtered = queue.filter((m) => m.id !== id);
  saveQueue(filtered);
}

// Get queued messages for a specific target
export function getQueuedMessagesForTarget(type: QueuedMessageType, targetId: string): QueuedMessage[] {
  return getQueuedMessages().filter((m) => m.type === type && m.targetId === targetId);
}

// Send a single queued message to the server
async function sendQueuedMessage(message: QueuedMessage): Promise<boolean> {
  try {
    let error;

    switch (message.type) {
      case "team":
        ({ error } = await supabase.from("team_messages").insert({
          team_id: message.targetId,
          author_id: message.authorId,
          text: message.text,
          image_url: message.imageUrl,
          reply_to_id: message.replyToId,
        }));
        break;
      case "club":
        ({ error } = await supabase.from("club_messages").insert({
          club_id: message.targetId,
          author_id: message.authorId,
          text: message.text,
          image_url: message.imageUrl,
          reply_to_id: message.replyToId,
        }));
        break;
      case "group":
        ({ error } = await supabase.from("group_messages").insert({
          group_id: message.targetId,
          author_id: message.authorId,
          text: message.text,
          image_url: message.imageUrl,
          reply_to_id: message.replyToId,
        }));
        break;
      case "broadcast":
        ({ error } = await supabase.from("broadcast_messages").insert({
          author_id: message.authorId,
          text: message.text,
          image_url: message.imageUrl,
          reply_to_id: message.replyToId,
        }));
        break;
      case "dm":
        ({ error } = await supabase.from("direct_messages").insert({
          conversation_id: message.targetId,
          author_id: message.authorId,
          text: message.text,
          image_url: message.imageUrl,
          reply_to_id: message.replyToId,
        }));
        break;
      case "club_admin":
        ({ error } = await supabase.from("club_admin_messages").insert({
          conversation_id: message.targetId,
          author_id: message.authorId,
          text: message.text,
          image_url: message.imageUrl,
          reply_to_id: message.replyToId,
        }));
        break;
      default:
        return false;
    }

    if (error) {
      console.error("Failed to send queued message:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending queued message:", error);
    return false;
  }
}

// Sync all queued messages - returns number of messages synced
export async function syncQueuedMessages(): Promise<{ synced: number; failed: number }> {
  const queue = getQueuedMessages();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  const remainingQueue: QueuedMessage[] = [];

  for (const message of queue) {
    const success = await sendQueuedMessage(message);
    
    if (success) {
      synced++;
      // Vault sync happens ONLY after a confirmed insert, exactly once per
      // queued message (the row is dropped from the queue below, so a retry
      // can never mirror the same message twice). Fire-and-forget: a Vault
      // failure must never make a delivered message look undelivered.
      await syncQueuedMessageToVault(message);
    } else {
      message.retryCount++;
      if (message.retryCount < MAX_RETRIES) {
        remainingQueue.push(message);
      } else {
        failed++;
        console.error("Message exceeded max retries, discarding:", message.id);
      }
    }
  }

  saveQueue(remainingQueue);
  return { synced, failed };
}

/**
 * Mirror a successfully-delivered queued message's attachment/file links into
 * the Vault using the scope captured when it was queued. Failures are logged
 * only — `chatVaultSync` performs its own duplicate-URL protection.
 */
async function syncQueuedMessageToVault(message: QueuedMessage): Promise<void> {
  const vault = message.vault;
  if (!vault?.clubId) return;
  if (!message.imageUrl && !message.text) return;
  try {
    const { syncChatAttachmentToVault } = await import("@/lib/chatVaultSync");
    await syncChatAttachmentToVault({
      imageUrl: message.imageUrl,
      text: message.text,
      userId: message.authorId,
      clubId: vault.clubId,
      teamId: vault.teamId ?? null,
      chatGroupId: vault.chatGroupId ?? null,
      chatGroupName: vault.chatGroupName ?? null,
      chatGroupAllowedRoles: vault.chatGroupAllowedRoles ?? null,
      isClubAdminChat: vault.isClubAdminChat ?? false,
    });
  } catch (err) {
    console.warn("Queued message vault sync failed:", err);
  }
}

// Check if there are any queued messages
export function hasQueuedMessages(): boolean {
  return getQueuedMessages().length > 0;
}

// Get queue count
export function getQueueCount(): number {
  return getQueuedMessages().length;
}
