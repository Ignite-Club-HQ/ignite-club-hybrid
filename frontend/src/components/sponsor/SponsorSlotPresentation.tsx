import { useEffect, useMemo, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  createTierWeightedPlaylist,
  sponsorTierDuration,
  type SponsorTier,
  type TieredSponsor,
} from "./sponsorTier";

export interface SponsorSlotPlacement {
  containerClassName: string;
  sponsorLabel: string;
  adLabel: string;
}

export const CARD_SPONSOR_SLOT_PLACEMENT: SponsorSlotPlacement = {
  containerClassName: "rounded-lg border bg-card",
  sponsorLabel: "Club Sponsor",
  adLabel: "Sponsor",
};

export const CHAT_THREAD_SPONSOR_SLOT_PLACEMENT: SponsorSlotPlacement = {
  containerClassName: "shrink-0 border-b bg-card",
  sponsorLabel: "Club Sponsor",
  adLabel: "Sponsor",
};

interface SponsorSlotBase {
  id: string;
  name: string;
  onActivate: () => void;
}

interface SponsorSlotSponsor extends SponsorSlotBase {
  kind: "sponsor";
  logoUrl: string | null;
  websiteUrl: string | null;
  onDismiss: () => void;
}

interface SponsorSlotAd extends SponsorSlotBase {
  kind: "ad";
  imageUrl: string | null;
  linkUrl: string | null;
  headline: string | null;
}

export type SponsorSlotItem = SponsorSlotSponsor | SponsorSlotAd;

interface SponsorSlotPresentationProps {
  item: SponsorSlotItem;
  placement: SponsorSlotPlacement;
}

export function SponsorSlotPresentation({ item, placement }: SponsorSlotPresentationProps) {
  const isSponsor = item.kind === "sponsor";
  const clickable = isSponsor ? !!item.websiteUrl : !!item.linkUrl;
  const title = isSponsor ? item.name : item.headline || item.name;
  const imageUrl = isSponsor ? item.logoUrl : item.imageUrl;

  return (
    <div className={`${placement.containerClassName} ${isSponsor ? "flex items-center" : ""}`}>
      <button
        type="button"
        onClick={() => {
          if (clickable) item.onActivate();
        }}
        disabled={!clickable}
        className={`${isSponsor ? "flex-1 min-w-0" : "w-full"} flex items-center gap-2 px-3 py-2 text-left ${
          clickable ? "hover:bg-muted/50 transition-colors cursor-pointer" : "cursor-default"
        }`}
      >
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium shrink-0">
          {isSponsor ? placement.sponsorLabel : placement.adLabel}
        </span>
        <Avatar className={`h-6 w-6 shrink-0 ${isSponsor ? "" : "rounded-md"}`}>
          <AvatarImage src={imageUrl || undefined} className={isSponsor ? undefined : "object-cover"} />
          <AvatarFallback className={`text-[10px] bg-secondary ${isSponsor ? "" : "rounded-md"}`}>
            {title.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium truncate flex-1 min-w-0">{title}</span>
        {clickable && <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      </button>
      {isSponsor && (
        <button
          type="button"
          onClick={item.onDismiss}
          aria-label="Dismiss club sponsor"
          className="shrink-0 p-2 mr-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function useTieredSponsorSlot<T extends TieredSponsor>(
  sponsors: readonly T[],
  enabled: boolean,
): T | null {
  const playlist = useMemo(() => createTierWeightedPlaylist(sponsors), [sponsors]);
  const [playlistPosition, setPlaylistPosition] = useState(0);

  useEffect(() => {
    setPlaylistPosition(0);
  }, [playlist.length]);

  const sponsorIndex = playlist.length > 0 ? playlist[playlistPosition % playlist.length] : 0;
  const activeSponsor = enabled && sponsors.length > 0 ? sponsors[sponsorIndex] : null;

  useEffect(() => {
    if (!activeSponsor || playlist.length <= 1) return;
    const timeout = setTimeout(
      () => setPlaylistPosition(position => (position + 1) % playlist.length),
      sponsorTierDuration(activeSponsor.tier),
    );
    return () => clearTimeout(timeout);
  }, [activeSponsor, playlist.length, playlistPosition]);

  return activeSponsor;
}

export function useRotatingSponsorSlotIndex(itemCount: number, enabled: boolean): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!enabled || itemCount <= 1) return;
    const interval = setInterval(() => setIndex(current => (current + 1) % itemCount), 12_000);
    return () => clearInterval(interval);
  }, [enabled, itemCount]);

  return index;
}

export type { SponsorTier };
