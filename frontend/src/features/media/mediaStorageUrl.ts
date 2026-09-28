export const MEDIA_BUCKET = "photos";

export function mediaStorageOrigin(): string {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) throw new Error("Media storage is not configured");
  return url.replace(/\/+$/, "");
}

export function buildMediaStorageUrl(storagePath: string): string {
  const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
  return `${mediaStorageOrigin()}/storage/v1/object/public/${MEDIA_BUCKET}/${encodedPath}`;
}
