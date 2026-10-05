import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { onlineManager } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { getActiveIcpTarget } from "@/live/targetRegistry";
import { listBlobStoreCanisterIds } from "@/live/mediaStorage";

/**
 * Global "reconnect epoch" that bumps whenever the browser reports it has
 * come back online or the tab becomes visible again with network available.
 *
 * Radix `AvatarImage` tracks the underlying `<img>` load status internally.
 * If the initial fetch fails (e.g. the connection drops mid-load), it flips
 * to the `error` state and shows `AvatarFallback` — and it never retries,
 * even after the network returns. That's why the club logo and profile
 * avatar in the header can stay blank until a full page reload after Wi-Fi
 * or mobile data reconnects.
 *
 * We remount `AvatarPrimitive.Image` whenever the epoch changes so the
 * image element re-runs its request with the network available.
 */
let reconnectEpoch = 0;
const epochListeners = new Set<() => void>();

function bumpReconnectEpoch() {
  reconnectEpoch += 1;
  epochListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* ignore */
    }
  });
}

if (typeof window !== "undefined") {
  let lastBumpAt = 0;
  const THROTTLE_MS = 1500;
  const maybeBump = () => {
    const now = Date.now();
    if (now - lastBumpAt < THROTTLE_MS) return;
    lastBumpAt = now;
    bumpReconnectEpoch();
  };

  window.addEventListener("online", maybeBump);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine !== false) {
      maybeBump();
    }
  });
  // Also react to React Query's online manager (covers native + manual toggles).
  onlineManager.subscribe(() => {
    if (onlineManager.isOnline()) maybeBump();
  });
}

function useReconnectEpoch() {
  return React.useSyncExternalStore(
    (cb) => {
      epochListeners.add(cb);
      return () => epochListeners.delete(cb);
    },
    () => reconnectEpoch,
    () => 0,
  );
}

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", className)}
    {...props}
  />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

/**
 * ICP profile photos live on the media_blob_store canister as IBE
 * ciphertext, so their URLs cannot be handed to <img> directly. When `src`
 * points at the configured blob store, resolve it to a decrypted object URL
 * (the same path useSignedPhotoUrl/resolveIcpBlobObjectUrl uses for chat
 * and media). Everything else passes through untouched, so Supabase-mode
 * avatars render exactly as before — including the synchronous first render
 * (no fallback flash).
 *
 * Resolved object URLs are cached for the session (they die with it
 * anyway). Failures (no decrypt grant yet, offline) show the initials
 * fallback and are retried after a cooldown instead of on every remount, so
 * member lists don't hammer the canister.
 */
const decryptedAvatarCache = new Map<string, string>();
const failedAvatarCache = new Map<string, number>();
const AVATAR_FAILURE_RETRY_MS = 60_000;

function isIcpBlobUrl(src: string): boolean {
  try {
    const target = getActiveIcpTarget();
    const stores = listBlobStoreCanisterIds(target);
    if (stores.length === 0) return false;
    const url = new URL(src);
    if (url.hostname === "icp0.io" || url.hostname === "raw.icp0.io") {
      return stores.includes(url.pathname.replace(/^\/+/, "").split("/")[0]);
    }
    const sub = /^([a-z0-9-]+)\.(?:raw\.)?icp0\.io$/.exec(url.hostname)?.[1];
    return !!sub && stores.includes(sub);
  } catch {
    return false;
  }
}

function useResolvedAvatarSrc(src: string | undefined): string | undefined {
  const [resolved, setResolved] = React.useState<string | undefined>(() => {
    if (!src || !isIcpBlobUrl(src)) return src;
    return decryptedAvatarCache.get(src);
  });

  React.useEffect(() => {
    if (!src || !isIcpBlobUrl(src)) {
      setResolved(src);
      return;
    }
    const cached = decryptedAvatarCache.get(src);
    if (cached) {
      setResolved(cached);
      return;
    }
    const failedAt = failedAvatarCache.get(src);
    if (failedAt && Date.now() - failedAt < AVATAR_FAILURE_RETRY_MS) {
      setResolved(undefined);
      return;
    }
    let cancelled = false;
    // Dynamic import: the decrypt path pulls in the vetKeys SDK, which must
    // stay out of the initial bundle for Supabase sessions.
    import("@/live/mediaDecrypt")
      .then((m) => m.resolveIcpBlobObjectUrl(src))
      .then((url) => {
        if (url) decryptedAvatarCache.set(src, url);
        if (!cancelled) setResolved(url ?? undefined);
      })
      .catch(() => {
        failedAvatarCache.set(src, Date.now());
        if (!cancelled) setResolved(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  return resolved;
}

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, alt = "", src, ...props }, ref) => {
  const epoch = useReconnectEpoch();
  const resolvedSrc = useResolvedAvatarSrc(typeof src === "string" ? src : undefined);
  // Keying by src + epoch forces Radix to remount its internal <img> when
  // the network comes back, so images that failed to load during an offline
  // window (e.g. club logo, profile avatar) retry automatically.
  return (
    <AvatarPrimitive.Image
      key={`${resolvedSrc ?? ""}::${epoch}`}
      ref={ref}
      src={resolvedSrc}
      alt={alt}
      decoding="async"
      className={cn("aspect-square h-full w-full", className)}
      {...props}
    />
  );
});
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn("flex h-full w-full items-center justify-center rounded-full bg-muted", className)}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarImage, AvatarFallback };
