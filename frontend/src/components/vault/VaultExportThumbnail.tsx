import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";

export function VaultExportThumbnail({ url, title }: { url: string; title: string }) {
  const { signedUrl } = useSignedPhotoUrl(url);
  return signedUrl
    ? <img src={signedUrl} alt={title} className="h-10 w-10 object-cover rounded" />
    : <div className="h-10 w-10 shrink-0 rounded bg-muted" />;
}