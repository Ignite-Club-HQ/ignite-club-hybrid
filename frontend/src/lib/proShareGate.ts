import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { NavigateFunction } from "react-router-dom";

/**
 * Async Pro check used to gate share actions (photos, events).
 * Checks team-level pro first (if team_id given), then club-level.
 * If neither team nor club id is supplied, denies by default.
 */
export async function checkProForShare(opts: {
  teamId?: string | null;
  clubId?: string | null;
}): Promise<{ allowed: boolean; clubId: string | null }> {
  const { teamId, clubId: rawClubId } = opts;
  let clubId = rawClubId ?? null;

  try {
    if (teamId) {
      const { data } = await supabase.rpc("has_active_pro_for_team", { _team_id: teamId });
      if (data === true) {
        if (!clubId) {
          const { data: team } = await supabase
            .from("teams")
            .select("club_id")
            .eq("id", teamId)
            .maybeSingle();
          clubId = (team?.club_id as string) ?? null;
        }
        return { allowed: true, clubId };
      }
      if (!clubId) {
        const { data: team } = await supabase
          .from("teams")
          .select("club_id")
          .eq("id", teamId)
          .maybeSingle();
        clubId = (team?.club_id as string) ?? null;
      }
    }

    if (clubId) {
      const { data } = await supabase.rpc("has_active_pro_for_club", { _club_id: clubId });
      if (data === true) return { allowed: true, clubId };
    }
  } catch (err) {
    console.warn("[proShareGate] check failed:", err);
  }

  return { allowed: false, clubId };
}

/**
 * Convenience wrapper: returns true if allowed, else toasts and navigates
 * to the club upgrade page (when a clubId is known). Returns false when blocked.
 */
export async function gateShareWithPro(
  opts: { teamId?: string | null; clubId?: string | null; navigate?: NavigateFunction; featureLabel?: string },
): Promise<boolean> {
  const { allowed, clubId } = await checkProForShare(opts);
  if (allowed) return true;
  const label = opts.featureLabel || "Sharing";
  toast.error(`${label} is a Pro feature`, {
    description: clubId
      ? "Upgrade your club to Pro to share."
      : "Contact your club admin to upgrade to Pro.",
    action: clubId && opts.navigate
      ? { label: "Upgrade", onClick: () => opts.navigate!(`/clubs/${clubId}/upgrade`) }
      : undefined,
  });
  return false;
}
