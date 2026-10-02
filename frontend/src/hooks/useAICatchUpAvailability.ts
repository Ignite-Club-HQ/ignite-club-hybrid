import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ChatScopeType } from "@/hooks/useChatCatchUp";
import { useChatRecapGloballyEnabled } from "@/hooks/useChatRecapGloballyEnabled";
import { withFeatureBackend } from "@/live/featureRouter";
import { getLiveTeam } from "@/live/features/club";
import { getLiveGroupMetadata, getLiveClubDmSettings, getLiveUserMessagingSettings } from "@/live/features/messaging";
import { getLiveMyRoleGrants } from "@/live/features/membership";

/**
 * Resolves whether the AI Chat Recap feature has been turned off either at
 * the club level (admin toggle) or for the current user (personal setting).
 * Direct messages have no owning club, so `clubDisabled` is always false there.
 */
export function useAICatchUpAvailability(
  scope_type: ChatScopeType,
  scope_id: string | null | undefined,
) {
  const globallyEnabled = useChatRecapGloballyEnabled();
  const { data: clubDisabled } = useQuery({
    queryKey: ["club-ai-catchup-flag", scope_type, scope_id],
    enabled: !!scope_id && scope_type !== "direct",
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      return withFeatureBackend("messaging", {
        supabase: async () => {
          let clubId: string | null = null;
          if (scope_type === "club") clubId = scope_id!;
          else if (scope_type === "team") {
            const { data } = await supabase.from("teams").select("club_id").eq("id", scope_id!).maybeSingle();
            clubId = (data?.club_id as string) ?? null;
          } else if (scope_type === "group") {
            const { data } = await supabase.from("chat_groups").select("club_id").eq("id", scope_id!).maybeSingle();
            clubId = (data?.club_id as string) ?? null;
          } else if (scope_type === "club_admin") {
            const { data } = await supabase.from("club_admin_conversations").select("club_id").eq("id", scope_id!).maybeSingle();
            clubId = (data?.club_id as string) ?? null;
          }
          if (!clubId) return false;
          const { data: club } = await supabase
            .from("clubs")
            .select("ai_catch_up_enabled")
            .eq("id", clubId)
            .maybeSingle();
          const disabled = (club as any)?.ai_catch_up_enabled === false;
          if (!disabled) return false;

          // Admins (app_admin, club_admin of this club, committee_member of this club)
          // bypass the club-level disable so they can test the feature.
          const { data: auth } = await supabase.auth.getUser();
          const uid = auth.user?.id;
          if (!uid) return true;
          const { data: roles } = await supabase
            .from("user_roles")
            .select("role, club_id")
            .eq("user_id", uid);
          const isAdmin = (roles ?? []).some((r: any) =>
            r.role === "app_admin" ||
            ((r.role === "club_admin" || r.role === "committee_member") && r.club_id === clubId)
          );
          return !isAdmin;
        },
        icp: async (ctx) => {
          // club_admin conversations have no canister equivalent yet (the
          // Supabase `club_admin_conversations` table has no counterpart),
          // so that scope always resolves to "not disabled" in ICP mode.
          let clubId: string | null = null;
          if (scope_type === "club") clubId = scope_id!;
          else if (scope_type === "team") {
            const team = await getLiveTeam(ctx, scope_id!);
            clubId = (team as any)?.club_id ?? null;
          } else if (scope_type === "group") {
            const metadata = await getLiveGroupMetadata(ctx, scope_id!);
            clubId = metadata.clubId;
          }
          if (!clubId) return false;
          const settings = await getLiveClubDmSettings(ctx, clubId);
          const disabled = settings.ai_catch_up_enabled === false;
          if (!disabled) return false;

          const grants = await getLiveMyRoleGrants(ctx);
          const isAdmin = grants.some((g) =>
            g.role === "app_admin" ||
            ((g.role === "club_admin" || g.role === "committee_member") && g.club === clubId)
          );
          return !isAdmin;
        },
      });
    },
  });

  const { data: userDisabled } = useQuery({
    queryKey: ["user-ai-catchup-pref"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      return withFeatureBackend("messaging", {
        supabase: async () => {
          const { data: auth } = await supabase.auth.getUser();
          const uid = auth.user?.id;
          if (!uid) return false;
          const { data } = await supabase
            .from("profiles")
            .select("ai_catch_up_enabled")
            .eq("id", uid)
            .maybeSingle();
          return (data as any)?.ai_catch_up_enabled === false;
        },
        icp: async (ctx) => {
          const settings = await getLiveUserMessagingSettings(ctx);
          return settings.ai_catchup_enabled === false;
        },
      });
    },
  });

  return {
    clubDisabled: clubDisabled === true,
    userDisabled: userDisabled === true,
    // App-admin master switch wins over club/user settings.
    featureDisabled: !globallyEnabled || clubDisabled === true || userDisabled === true,
  };
}
