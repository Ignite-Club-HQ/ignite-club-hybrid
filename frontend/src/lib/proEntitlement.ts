export interface ClubSubscriptionEntitlements {
  is_pro?: boolean | null;
  is_pro_football?: boolean | null;
  admin_pro_override?: boolean | null;
  admin_pro_football_override?: boolean | null;
  expires_at?: string | null;
}

export function resolveClubProAccess(
  sub: ClubSubscriptionEntitlements | null,
  now = new Date(),
) {
  if (!sub) return { hasPro: false, hasProFootball: false, resolved: true };

  const notExpired = !sub.expires_at || new Date(sub.expires_at) > now;
  const hasPro = notExpired && !!(sub.is_pro || sub.admin_pro_override);
  const hasProFootball =
    notExpired && !!(sub.is_pro_football || sub.admin_pro_football_override);

  return {
    hasPro: hasPro || hasProFootball,
    hasProFootball,
    resolved: true,
  };
}
