/**
 * Explicit delivery-state model for chat send mutations.
 *
 * A resolved send mutation means one of two very different things:
 *   - `delivered` — the row was inserted and confirmed by the server, or the
 *     insert reported an error but the authoritative row was proven to exist.
 *   - `queued`    — the device was offline and the message was only appended to
 *                   the local outbox; nothing exists server-side yet.
 *
 * Side effects that assume a real message row (e.g. mirroring attachments and
 * file links into the Vault) must run ONLY for `delivered`. Never infer
 * delivery from the mutation promise merely resolving.
 */

export type ChatDeliveryState = "delivered" | "queued";

export const DELIVERY_FIELD = "__delivery" as const;

export interface ChatSendDeliveryMarker {
  __delivery: ChatDeliveryState;
}

export const deliveredSend = (): ChatSendDeliveryMarker => ({ __delivery: "delivered" });
export const queuedSend = (): ChatSendDeliveryMarker => ({ __delivery: "queued" });

/** True only when the send result is explicitly marked as confirmed delivery. */
export function isConfirmedDelivery(result: unknown): boolean {
  return (
    !!result &&
    typeof result === "object" &&
    (result as Partial<ChatSendDeliveryMarker>).__delivery === "delivered"
  );
}

/** True when the send result is explicitly an offline-queue acceptance. */
export function isQueuedAcceptance(result: unknown): boolean {
  return (
    !!result &&
    typeof result === "object" &&
    (result as Partial<ChatSendDeliveryMarker>).__delivery === "queued"
  );
}
