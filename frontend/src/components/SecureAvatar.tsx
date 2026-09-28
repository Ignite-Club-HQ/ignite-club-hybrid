import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { cn } from "@/lib/utils";

interface SecureAvatarProps {
  src?: string | null;
  fallback?: string;
  className?: string;
  fallbackClassName?: string;
}

/**
 * Avatar component that handles signed URLs for private storage buckets.
 * Use this for avatars stored in the private 'avatars' bucket.
 */
export function SecureAvatar({ 
  src, 
  fallback, 
  className,
  fallbackClassName 
}: SecureAvatarProps) {
  const { signedUrl, isLoading } = useSignedPhotoUrl(src);
  
  // Use signed URL if available, otherwise fallback to original
  const effectiveSrc = signedUrl || src || undefined;

  return (
    <Avatar className={className}>
      {isLoading ? (
        <div className="w-full h-full bg-muted animate-pulse rounded-full" />
      ) : (
        <AvatarImage src={effectiveSrc} />
      )}
      {fallback && (
        <AvatarFallback className={cn("text-xs", fallbackClassName)}>
          {fallback}
        </AvatarFallback>
      )}
    </Avatar>
  );
}
