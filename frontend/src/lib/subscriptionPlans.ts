/** Approved USD catalog. New SKUs are deliberately separate from legacy paid terms. */
export type ClubPlan = "small" | "growing" | "starter" | "standard";
export type PaidTier = "pro" | "pro_football";
export const CLUB_PLAN_ORDER: readonly ClubPlan[] = ["small", "growing", "starter", "standard"];
export const CLUB_PLAN_NAMES: Record<ClubPlan, string> = {
  small: "Small Club", growing: "Growing Club", starter: "Established Club", standard: "Large Club",
};
export const CLUB_PRICING = {
  pro: {
    small: { monthly: 44.99, annual: 489, teamLimit: 3 },
    growing: { monthly: 64.99, annual: 699, teamLimit: 5 },
    starter: { monthly: 109.99, annual: 1199, teamLimit: 10 },
    standard: { monthly: 209.99, annual: 2299, teamLimit: 20 },
  },
  proFootball: {
    small: { monthly: 59.99, annual: 649, teamLimit: 3 },
    growing: { monthly: 84.99, annual: 929, teamLimit: 5 },
    starter: { monthly: 139.99, annual: 1539, teamLimit: 10 },
    standard: { monthly: 259.99, annual: 2849, teamLimit: 20 },
  },
} as const;
export const TEAM_PRICING = {
  pro: { monthly: 24.99, annual: 269 },
  proFootball: { monthly: 34.99, annual: 379 },
} as const;
export const FREE_MEDIA_BYTES = 250 * 1024 ** 2;
export const CLUB_MEDIA_BYTES = 3 * 1024 ** 3;
export const TEAM_MEDIA_BYTES = 1024 ** 3;
export function recommendedClubPlan(count: number): ClubPlan {
  return CLUB_PLAN_ORDER.find(plan => count <= CLUB_PRICING.pro[plan].teamLimit) ?? "standard";
}
export function clubQuote(tier: PaidTier, plan: ClubPlan, extraTeams: number, annual: boolean) {
  if (!Number.isSafeInteger(extraTeams) || extraTeams < 0 || extraTeams > 99_980 || (extraTeams > 0 && plan !== "standard")) {
    throw new Error("Additional teams require the Large Club plan.");
  }
  const pricing = tier === "pro" ? CLUB_PRICING.pro : CLUB_PRICING.proFootball;
  const extraPrice = tier === "pro" ? (annual ? 165 : 15) : (annual ? 220 : 20);
  return { currency: "USD" as const, amount: pricing[plan][annual ? "annual" : "monthly"] + extraTeams * extraPrice,
    teamLimit: pricing[plan].teamLimit + extraTeams, storageBytes: CLUB_MEDIA_BYTES };
}
export function clubProductId(tier: PaidTier, plan: ClubPlan, annual: boolean, extraTeams = 0): string {
  const quote = clubQuote(tier, plan, extraTeams, annual);
  return `ignite_v2_${tier === "pro" ? "pro" : "pf"}_${plan}_${quote.teamLimit}_${annual ? "annual" : "monthly"}`;
}
export function teamProductId(tier: PaidTier, annual: boolean): string {
  return `ignite_v2_team_${tier === "pro" ? "pro" : "pf"}_${annual ? "annual" : "monthly"}`;
}
/** Free retains existing team rules up to 20. No missing/expired row grants team 21. */
export function effectiveTeamLimit(sub: { team_limit?: number | null; is_pro?: boolean; is_pro_football?: boolean;
  admin_pro_override?: boolean; admin_pro_football_override?: boolean; expires_at?: string | null;
  is_trial?: boolean; trial_ends_at?: string | null; plan?: string | null } | null | undefined, now = Date.now()): number {
  if (!sub) return 20;
  const override = sub.admin_pro_override || sub.admin_pro_football_override;
  const paid = (sub.is_pro || sub.is_pro_football) && (!sub.expires_at || Date.parse(sub.expires_at) > now);
  const trial = sub.is_trial && !!sub.trial_ends_at && Date.parse(sub.trial_ends_at) > now;
  if (!(override || paid || trial)) return 20;
  if ((override || paid) && sub.plan === "unlimited" && sub.team_limit == null) return 100_000;
  const limit = sub.team_limit;
  if (limit == null || !Number.isSafeInteger(limit) || limit < 1) return 20;
  return trial && !paid && !override ? Math.min(20, limit) : limit;
}
/** A quote is not permission to charge for an unconfigured provider product. */
export function assertPurchaseCatalogReady(productId: string, readyProducts: readonly string[]): void {
  if (productId.startsWith("ignite_v2_") && !readyProducts.includes(productId)) {
    throw new Error("The new plans are not available for purchase yet. Your existing subscription is unchanged.");
  }
}

export type MediaSubscription = Parameters<typeof effectiveTeamLimit>[0] & { storage_purchased_gb?: number | null };
export function hasActiveMediaSubscription(sub: MediaSubscription, now = Date.now()): boolean {
  if (!sub) return false;
  return !!(sub.admin_pro_override || sub.admin_pro_football_override ||
    ((sub.is_pro || sub.is_pro_football) && (!sub.expires_at || Date.parse(sub.expires_at) > now)) ||
    (sub.is_trial && sub.trial_ends_at && Date.parse(sub.trial_ends_at) > now));
}
export function mediaAllowance(sub: MediaSubscription, teamSub?: MediaSubscription, now = Date.now()) {
  const premiumClub = hasActiveMediaSubscription(sub, now);
  const premiumTeam = !premiumClub && hasActiveMediaSubscription(teamSub, now);
  const baseBytes = premiumClub ? (sub?.plan === "unlimited" ? 5 * 1024 ** 3 : CLUB_MEDIA_BYTES) : premiumTeam ? TEAM_MEDIA_BYTES : FREE_MEDIA_BYTES;
  const purchased = sub?.storage_purchased_gb ?? 0;
  if (!Number.isSafeInteger(purchased) || purchased < 0) throw new Error("Could not check storage allowance.");
  return { baseBytes, limitBytes: baseBytes + (premiumTeam ? 0 : purchased * 1024 ** 3), teamScoped: premiumTeam, premium: premiumClub || premiumTeam };
}
