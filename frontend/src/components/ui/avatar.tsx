import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { onlineManager } from "@tanstack/react-query";

import { cn } from "@/lib/utils";

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

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, alt = "", src, ...props }, ref) => {
  const epoch = useReconnectEpoch();
  // Keying by src + epoch forces Radix to remount its internal <img> when
  // the network comes back, so images that failed to load during an offline
  // window (e.g. club logo, profile avatar) retry automatically.
  return (
    <AvatarPrimitive.Image
      key={`${src ?? ""}::${epoch}`}
      ref={ref}
      src={src}
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
