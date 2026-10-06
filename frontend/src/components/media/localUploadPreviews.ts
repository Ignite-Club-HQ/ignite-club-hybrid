/**
 * Session-only map of blob-store URL -> local object URL for photos this
 * device just uploaded, so the feed shows them instantly without a
 * download + key unlock round trip. Never persisted.
 */
export const localUploadPreviews = new Map<string, string>();
