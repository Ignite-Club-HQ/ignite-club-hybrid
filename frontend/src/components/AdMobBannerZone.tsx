import { useAdMobBanner } from "@/hooks/useAdMob";

interface AdMobBannerZoneProps {
  /** Should the banner be visible? Gate this with isProUser === false */
  show: boolean;
}

/**
 * Renders nothing visually — this component triggers the native AdMob banner
 * overlay on mobile. On web it's a no-op.
 */
export function AdMobBannerZone({ show }: AdMobBannerZoneProps) {
  useAdMobBanner(show);
  return null;
}
