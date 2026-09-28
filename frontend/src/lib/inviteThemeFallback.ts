/**
 * Defensive club-theme seeding from invites.
 *
 * The primary seeding path uses the pending invites that the profile/welcome
 * flows just processed. That path misses the case where the invite was ALREADY
 * marked accepted (e.g. by the DB trigger, or by a previous partially
 * completed run) — the invite list then comes back empty and no club filter is
 * applied.
 *
 * This helper looks up invites for the signed-in user by `invited_user_id` OR
 * matching email, accepting both `pending` and recently `accepted` rows, and
 * seeds the club filter through `seedClubFilterFromInvite` (which never
 * overrides an explicit user choice).
 */
import { supabase } from "@/integrations/supabase/client";
import { seedClubFilterFromInvite } from "@/lib/seedClubFilterFromInvite";

const RECENT_ACCEPT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function seedClubThemeFromAnyInvite(
  user: { id: string; email?: string | null } | null | undefined,
  setActiveClubTheme: (clubId: string | null) => void,
): Promise<string | null> {
  if (!user?.id) return null;

  try {
    const email = user.email?.toLowerCase() ?? null;
    const orFilter = email
      ? `invited_user_id.eq.${user.id},invited_email.ilike.${email}`
      : `invited_user_id.eq.${user.id}`;

    const { data, error } = await supabase
      .from("pending_invites")
      .select("club_id, team_id, status, accepted_at, created_at, teams:team_id(club_id)")
      .or(orFilter)
      .in("status", ["pending", "accepted"])
      .order("created_at", { ascending: true })
      .limit(20);

    if (error || !data?.length) return null;

    const cutoff = Date.now() - RECENT_ACCEPT_WINDOW_MS;
    const candidate = data.find((row: any) => {
      const clubId = row.club_id ?? row.teams?.club_id ?? null;
      if (!clubId) return false;
      if (row.status === "pending") return true;
      const acceptedAt = row.accepted_at ? Date.parse(row.accepted_at) : NaN;
      return Number.isNaN(acceptedAt) ? false : acceptedAt >= cutoff;
    }) as any;

    const clubId: string | null = candidate
      ? candidate.club_id ?? candidate.teams?.club_id ?? null
      : null;
    if (!clubId) return null;

    const seeded = seedClubFilterFromInvite(user.id, clubId, setActiveClubTheme);
    return seeded ? clubId : null;
  } catch (e) {
    console.warn("[inviteThemeFallback] Failed:", e);
    return null;
  }
}
