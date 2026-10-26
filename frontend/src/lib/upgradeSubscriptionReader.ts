import { withFeatureBackend } from "@/live/featureRouter";
import { supabase } from "@/integrations/supabase/client";

/** Subscription display always uses the dispatcher; page labels cannot choose a provider. */
export async function readUpgradeClubSubscription(clubId: string) {
  return withFeatureBackend("membership", {
    supabase: async () => {
      const { data, error } = await supabase.from("club_subscriptions")
        .select("*").eq("club_id", clubId).maybeSingle();
      if (error) throw error;
      return data;
    },
    icp: async (ctx) => {
      const { getLiveClubSubscription } = await import("@/live/features/club");
      const row = await getLiveClubSubscription(ctx, clubId);
      if (!row) return null;
      return {
        is_pro: row.is_pro || row.admin_pro_override,
        is_pro_football: row.is_pro_football || row.admin_pro_football_override,
        expires_at: row.expires_at_ms.length ? new Date(Number(row.expires_at_ms[0])).toISOString() : null,
        plan: row.plan || null,
        team_limit: row.team_limit.length ? Number(row.team_limit[0]) : null,
        is_trial: row.is_trial,
        trial_ends_at: row.trial_ends_at_ms.length ? new Date(Number(row.trial_ends_at_ms[0])).toISOString() : null,
      };
    },
  }, { clubId });
}