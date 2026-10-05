import { useEffect, useState, type ImgHTMLAttributes } from "react";

/**
 * News picture that also works for ICP blob-store addresses: those serve
 * only encrypted bytes, so they are unlocked into a local picture first.
 */
export function NewsImage({ src, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    (async () => {
      const { parseIcpBlobUrl, resolveIcpBlobObjectUrl } = await import("@/live/mediaDecrypt");
      if (!parseIcpBlobUrl(src)) {
        if (!cancelled) setResolved(src);
        return;
      }
      const url = await resolveIcpBlobObjectUrl(src).catch(() => null);
      if (!cancelled) setResolved(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);
  if (!resolved) return <div className={rest.className} aria-hidden="true" />;
  return <img src={resolved} {...rest} />;
}
