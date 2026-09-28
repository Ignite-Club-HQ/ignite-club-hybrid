import { useState } from "react";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { cn } from "@/lib/utils";

interface SecureImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  onClick?: () => void;
}

/**
 * Image component that handles signed URLs for private storage buckets.
 * Use this for images stored in private buckets like 'chat-attachments'.
 */
export function SecureImage({ 
  src, 
  alt, 
  className,
  onClick 
}: SecureImageProps) {
  const { signedUrl, isLoading } = useSignedPhotoUrl(src);
  const [imageLoaded, setImageLoaded] = useState(false);
  
  // Use signed URL if available, otherwise fallback to original
  const effectiveSrc = signedUrl || src || undefined;

  if (!src) return null;

  return (
    <div className={cn("relative", className)}>
      {(isLoading || !imageLoaded) && (
        <div className="absolute inset-0 bg-muted animate-pulse rounded" />
      )}
      {!isLoading && effectiveSrc && (
        <img
          src={effectiveSrc}
          alt={alt}
          className={cn(
            "transition-opacity duration-300",
            imageLoaded ? "opacity-100" : "opacity-0",
            className
          )}
          onLoad={() => setImageLoaded(true)}
          onClick={onClick}
        />
      )}
    </div>
  );
}
