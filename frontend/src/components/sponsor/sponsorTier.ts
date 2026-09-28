export type SponsorTier = "platinum" | "gold" | "silver" | "bronze" | null;

export interface TieredSponsor {
  tier: SponsorTier;
}

const TIER_WEIGHT: Record<Exclude<SponsorTier, null> | "default", number> = {
  platinum: 6,
  gold: 4,
  silver: 2,
  bronze: 1,
  default: 2,
};

const TIER_DURATION_MS: Record<Exclude<SponsorTier, null> | "default", number> = {
  platinum: 20_000,
  gold: 18_000,
  silver: 12_000,
  bronze: 8_000,
  default: 12_000,
};

export function sponsorTierKey(tier: SponsorTier): keyof typeof TIER_WEIGHT {
  return tier && tier in TIER_WEIGHT ? tier : "default";
}

export function createTierWeightedPlaylist(sponsors: readonly TieredSponsor[]): number[] {
  return sponsors.flatMap((sponsor, index) =>
    Array.from({ length: TIER_WEIGHT[sponsorTierKey(sponsor.tier)] }, () => index),
  );
}

export function sponsorTierDuration(tier: SponsorTier): number {
  return TIER_DURATION_MS[sponsorTierKey(tier)];
}
