/**
 * Single source of truth for classifying a `vault_files` row as an image
 * (rendered as a Vault "photo") or a non-image file.
 *
 * The active Vault view, recursive search and recursive export MUST all use
 * this classifier so a given row is never counted as both.
 */
export const VAULT_IMAGE_EXTENSION_RE =
  /\.(jpg|jpeg|png|gif|webp|bmp|svg|heic|heif|tiff|tif)$/i;

export interface VaultClassifiableItem {
  name?: string | null;
  file_url?: string | null;
  file_type?: string | null;
}

export const isVaultImageItem = (item: VaultClassifiableItem): boolean =>
  Boolean(item?.file_type?.startsWith("image/")) ||
  VAULT_IMAGE_EXTENSION_RE.test(item?.name || item?.file_url || "");
