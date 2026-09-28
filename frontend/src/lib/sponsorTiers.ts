export type SponsorTier = 'platinum' | 'gold' | 'silver' | 'bronze';

export const TIER_CONFIG: Record<SponsorTier, { label: string; weight: number; color: string; bgColor: string; textColor: string }> = {
  platinum: { label: 'Platinum', weight: 4, color: 'hsl(var(--foreground))', bgColor: 'bg-foreground/10', textColor: 'text-foreground' },
  gold: { label: 'Gold', weight: 3, color: '#ca8a04', bgColor: 'bg-yellow-500/15', textColor: 'text-yellow-600 dark:text-yellow-400' },
  silver: { label: 'Silver', weight: 2, color: '#6b7280', bgColor: 'bg-muted', textColor: 'text-muted-foreground' },
  bronze: { label: 'Bronze', weight: 1, color: '#b45309', bgColor: 'bg-orange-500/15', textColor: 'text-orange-700 dark:text-orange-400' },
};

export const TIER_ORDER: SponsorTier[] = ['platinum', 'gold', 'silver', 'bronze'];

/**
 * Get the effective exposure weight for a sponsor.
 * If exposure_percentage is set, use it directly (out of 100).
 * Otherwise, use tier weight (platinum=4, gold=3, silver=2, bronze=1, none=1).
 */
export function getExposureWeight(sponsor: { tier?: SponsorTier | null; exposure_percentage?: number | null }): number {
  if (sponsor.exposure_percentage != null && sponsor.exposure_percentage >= 0) {
    return sponsor.exposure_percentage;
  }
  if (sponsor.tier) {
    return TIER_CONFIG[sponsor.tier].weight;
  }
  return 1; // default weight
}

/**
 * Select a sponsor from a list using weighted random selection.
 * Higher weight = more likely to be selected.
 */
export function selectWeightedSponsor<T extends { tier?: SponsorTier | null; exposure_percentage?: number | null }>(
  sponsors: T[]
): T | null {
  if (sponsors.length === 0) return null;
  if (sponsors.length === 1) return sponsors[0];

  const weights = sponsors.map(s => getExposureWeight(s));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  
  if (totalWeight === 0) return sponsors[0];

  let random = Math.random() * totalWeight;
  for (let i = 0; i < sponsors.length; i++) {
    random -= weights[i];
    if (random <= 0) return sponsors[i];
  }
  return sponsors[sponsors.length - 1];
}

/**
 * Sort sponsors by tier priority (platinum first) then by display_order.
 */
export function sortSponsorsByTier<T extends { tier?: SponsorTier | null; display_order?: number }>(sponsors: T[]): T[] {
  return [...sponsors].sort((a, b) => {
    const tierA = a.tier ? TIER_ORDER.indexOf(a.tier) : TIER_ORDER.length;
    const tierB = b.tier ? TIER_ORDER.indexOf(b.tier) : TIER_ORDER.length;
    if (tierA !== tierB) return tierA - tierB;
    return (a.display_order || 0) - (b.display_order || 0);
  });
}
