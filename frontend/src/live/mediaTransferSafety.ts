/** Operator tooling only. Counts must come from a complete authenticated,
 * fenced inventory (gallery, chat, vault and article attachments), not UI rows.
 * Ciphertext cannot be moved between vetKey authorities by copying grants. */
export type MediaTransferInventory = {
  clubId: string;
  fromGroup: string;
  toGroup: string;
  complete: boolean;
  encryptedObjects: number;
  pendingUploads: number;
  sharedQuotaReady: boolean;
};
export function assertMediaTransferSafe(inventory: MediaTransferInventory, clubId: string, fromGroup: string, toGroup: string): void {
  if (!inventory.complete || inventory.clubId !== clubId || inventory.fromGroup !== fromGroup || inventory.toGroup !== toGroup)
    throw new Error('Complete authenticated media inventory required for this club move');
  if (![inventory.encryptedObjects, inventory.pendingUploads].every(n => Number.isSafeInteger(n) && n >= 0))
    throw new Error('Invalid media inventory counts');
  if (!inventory.sharedQuotaReady) throw new Error('Shared media quota must be verified before moving a club');
  if (inventory.pendingUploads !== 0) throw new Error('Unsettled uploads block the club move');
  if (inventory.encryptedObjects !== 0)
    throw new Error('Encrypted media requires a verified original-authority preservation or re-encryption migration; club move blocked');
}