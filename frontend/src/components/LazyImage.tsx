import { useState, useRef, useEffect } from "react";
import { useSignedPhotoUrl, resolveSignedUrl } from "@/hooks/useSignedPhotoUrl";
import { isVideoUrl } from "@/lib/videoUtils";

interface LazyImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  priority?: boolean;
  /** Render thumbnail width (px). Defaults to 480, set 0 to disable transform. */
  thumbWidth?: number;
}

// Convert any Supabase storage URL into the image-transform render endpoint
// at the requested width/quality. Skips videos and non-Supabase URLs.
function applyImageTransform(src: string, width: number, quality = 70): string {
  if (!src || width <= 0) return src;
  if (isVideoUrl(src)) return src;
  // Only transform Supabase storage object URLs (public/sign/authenticated).
  const objectMatch = src.match(/\/storage\/v1\/object\/(public|sign|authenticated)\//);
  const renderMatch = src.match(/\/storage\/v1\/render\/image\/(public|sign)\//);
  if (!objectMatch && !renderMatch) return src;

  let transformed = src;
  if (objectMatch) {
    transformed = src.replace(
      `/storage/v1/object/${objectMatch[1]}/`,
      `/storage/v1/render/image/${objectMatch[1] === "authenticated" ? "sign" : objectMatch[1]}/`,
    );
  }

  // Strip any existing width/quality/resize params, then append fresh ones.
  const [base, query = ""] = transformed.split("?");
  const params = new URLSearchParams(query);
  params.delete("width");
  params.delete("height");
  params.delete("quality");
  params.delete("resize");
  params.set("width", String(width));
  params.set("quality", String(quality));
  params.set("resize", "contain");
  return `${base}?${params.toString()}`;
}

// Tiny LQIP for blur-up placeholder
function getLqipUrl(src: string): string {
  return applyImageTransform(src, 20, 20);
}

export function LazyImage({ src, alt, className = "", priority = false, thumbWidth = 480 }: LazyImageProps) {
  const safeSrc = src || "";
  const [isLoaded, setIsLoaded] = useState(false);
  const [lqipLoaded, setLqipLoaded] = useState(false);
  const [isInView, setIsInView] = useState(priority);
  const [retrySrc, setRetrySrc] = useState<string | null>(null);
  const [retryAttempts, setRetryAttempts] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const prevSrcRef = useRef(safeSrc);

  const { signedUrl, isLoading: isLoadingSignedUrl } = useSignedPhotoUrl(
    safeSrc && (isInView || priority) ? safeSrc : null,
  );

  const baseSrc = signedUrl || safeSrc;
  const transformedSrc = applyImageTransform(baseSrc, thumbWidth);
  const effectiveSrc = retrySrc || transformedSrc;
  const lqipUrl = getLqipUrl(baseSrc);
  const hasLqip = lqipUrl !== baseSrc;

  useEffect(() => {
    if (prevSrcRef.current !== safeSrc) {
      setIsLoaded(false);
      setLqipLoaded(false);
      setRetrySrc(null);
      setRetryAttempts(0);
      prevSrcRef.current = safeSrc;
    }
  }, [safeSrc]);

  useEffect(() => {
    if (priority) {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px", threshold: 0 }
    );

    const currentImg = imgRef.current;
    if (currentImg) {
      const rect = currentImg.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight + 200 && rect.bottom > -200;
      if (isVisible) {
        setIsInView(true);
      } else {
        observer.observe(currentImg);
      }
    }

    return () => observer.disconnect();
  }, [priority, safeSrc]);

  const showAsVideo = isVideoUrl(safeSrc);

  // On load failure, force a fresh signed URL with a single short retry.
  // Recently-uploaded photos can briefly 404/403 while propagation finishes;
  // beyond one retry the placeholder is the better UX.
  const MAX_RETRIES = 1;
  const handleError = async () => {
    if (retryAttempts >= MAX_RETRIES || !safeSrc) return;
    const attempt = retryAttempts + 1;
    setRetryAttempts(attempt);
    await new Promise((r) => setTimeout(r, 500));
    try {
      const fresh = await resolveSignedUrl(safeSrc);
      const transformed = applyImageTransform(fresh, thumbWidth);
      const bust = `${transformed}${transformed.includes("?") ? "&" : "?"}r=${Date.now()}`;
      setRetrySrc(bust);
    } catch {
      // give up silently — placeholder will remain
    }
  };

  return (
    <>
      {!isLoaded && (!hasLqip || !lqipLoaded) ? (
        <div className="absolute inset-0 bg-muted animate-pulse" />
      ) : null}

      {!showAsVideo && hasLqip && isInView && !isLoadingSignedUrl && (
        <img
          src={lqipUrl}
          alt=""
          aria-hidden="true"
          className={`absolute inset-0 w-full h-full object-cover scale-110 blur-lg ${
            isLoaded ? "opacity-0 transition-opacity duration-200" : "opacity-100"
          }`}
          onLoad={() => setLqipLoaded(true)}
        />
      )}

      {!showAsVideo && (
        <img
          ref={imgRef}
          src={isInView && !isLoadingSignedUrl ? effectiveSrc : undefined}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className={`absolute inset-0 w-full h-full object-cover ${
            isLoaded ? "opacity-100 transition-opacity duration-200" : "opacity-0"
          } ${className}`}
          onLoad={() => setIsLoaded(true)}
          onError={handleError}
        />
      )}
      {showAsVideo && !isLoadingSignedUrl && (
        <>
          {/* Append #t=0.1 media fragment so the browser seeks to the first
              frame and paints it as a poster. We only reveal the <video> once
              a real frame has been decoded (onLoadedData / onSeeked) — using
              onLoadedMetadata alone caused a placeholder flash before the
              frame painted. A delayed metadata fallback handles Android
              WebView cases where loadeddata never fires. */}
          <video
            ref={imgRef as unknown as React.RefObject<HTMLVideoElement>}
            src={isInView ? `${baseSrc}${baseSrc.includes("#") ? "" : "#t=0.1"}` : undefined}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
              isLoaded ? "opacity-100" : "opacity-0"
            } ${className}`}
            preload="metadata"
            muted
            playsInline
            onLoadedData={() => setIsLoaded(true)}
            onSeeked={() => setIsLoaded(true)}
            onLoadedMetadata={() => {
              // Fallback for Android WebView: if no frame fires within 600ms,
              // reveal anyway so we don't sit on the skeleton forever.
              window.setTimeout(() => setIsLoaded(true), 600);
            }}
            onError={handleError}
          />
          {isLoaded && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-full bg-black/60 p-3">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d="M8 5v14l11-7z" /></svg>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
