import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 1 optimisation for MessagesPage cold load.
 *
 * Collapses 6+ role/permission round trips into one RPC call. Behind a runtime
 * flag (`localStorage.msg_bootstrap_v1 === "1"`) so we can verify parity per
 * user before cutting over.
 *
 * When enabled, the bootstrap result seeds the existing per-query cache keys
 * via `queryClient.setQueryData`. The existing `useQuery` blocks in
 * MessagesPage stay in place but become instant cache hits and their
 * `queryFn` is skipped for the `staleTime` window.
 *
 * Rollback: `localStorage.removeItem("msg_bootstrap_v1")` — no redeploy.
 */

export type AdminClubLite = { id: string; name: string; logo_url: string | null; sport: string | null };

export type MessagesBootstrap = {
  is_app_admin: boolean;
  is_committee_member: boolean;
  admin_club_ids: string[];
  admin_team_ids: string[];
  all_roles: Array<{ role: string; club_id: string | null; team_id: string | null }>;
  member_club_ids: string[];
  member_team_ids: string[];
  pro_club_ids: string[];
  pro_team_ids: string[];
  has_any_pro: boolean;
  admin_clubs: AdminClubLite[];
  club_pro_status: Record<string, boolean>;
};


const FLAG_KEY = "msg_bootstrap_v1";

/**
 * Enabled by default. Kill switches (no DevTools required):
 *   - Visit `/messages?bootstrap=off` to disable (persists across reloads)
 *   - Visit `/messages?bootstrap=on`  to re-enable
 *   - Visit `/messages?bootstrap=reset` to clear the override (default ON)
 *
 * localStorage values:
 *   - missing / "1" / "on"  → enabled (default)
 *   - "0" / "off"           → disabled
 */
export function isMessagesBootstrapEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Honour URL override first and persist it.
    const params = new URLSearchParams(window.location.search);
    const override = params.get("bootstrap");
    if (override === "off" || override === "0") {
      window.localStorage.setItem(FLAG_KEY, "off");
    } else if (override === "on" || override === "1") {
      window.localStorage.setItem(FLAG_KEY, "on");
    } else if (override === "reset") {
      window.localStorage.removeItem(FLAG_KEY);
    }
    const v = window.localStorage.getItem(FLAG_KEY);
    return v !== "off" && v !== "0";
  } catch {
    return true;
  }
}

// Dev helpers — still available from console if you ever get access.
if (typeof window !== "undefined") {
  (window as any).__enableMsgBootstrap = () => {
    window.localStorage.setItem(FLAG_KEY, "on");
    // eslint-disable-next-line no-console
    console.info("[msg-bootstrap] enabled");
  };
  (window as any).__disableMsgBootstrap = () => {
    window.localStorage.setItem(FLAG_KEY, "off");
    // eslint-disable-next-line no-console
    console.info("[msg-bootstrap] disabled");
  };
}

export function useMessagesPageBootstrap(userId: string | undefined, initialized: boolean) {
  const queryClient = useQueryClient();
  const enabled = !!userId && initialized && isMessagesBootstrapEnabled();

  const query = useQuery({
    queryKey: ["messages-page-bootstrap", userId],
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
    queryFn: async (): Promise<MessagesBootstrap> => {
      const { data, error } = await (supabase as any).rpc(
        "get_messages_page_bootstrap",
        { _user_id: userId }
      );
      if (error) throw error;
      const d = (data ?? {}) as Partial<MessagesBootstrap>;
      return {
        is_app_admin: !!d.is_app_admin,
        is_committee_member: !!d.is_committee_member,
        admin_club_ids: d.admin_club_ids ?? [],
        admin_team_ids: d.admin_team_ids ?? [],
        all_roles: d.all_roles ?? [],
        member_club_ids: d.member_club_ids ?? [],
        member_team_ids: d.member_team_ids ?? [],
        pro_club_ids: d.pro_club_ids ?? [],
        pro_team_ids: d.pro_team_ids ?? [],
        has_any_pro: !!d.has_any_pro,
        admin_clubs: d.admin_clubs ?? [],
        club_pro_status: d.club_pro_status ?? {},
      };
    },
  });

  // Seed the cache keys consumed by the existing useQuery blocks on
  // MessagesPage (and shared keys used elsewhere, e.g. is-app-admin).
  useEffect(() => {
    if (!enabled || !userId || !query.data) return;
    const b = query.data;

    // Shared key — also used by ~25 other pages. Seeding it warms their cache.
    queryClient.setQueryData(["is-app-admin", userId], b.is_app_admin);

    queryClient.setQueryData(["is-committee-member", userId], b.is_committee_member);
    queryClient.setQueryData(["admin-team-ids", userId], b.admin_team_ids);
    queryClient.setQueryData(
      ["user-all-roles", userId],
      b.all_roles.map((r) => ({ role: r.role, club_id: r.club_id, team_id: r.team_id }))
    );
    queryClient.setQueryData(["has-any-pro-access", userId], b.has_any_pro);

    // Phase 2: seed admin-clubs (full Club[]) and club-pro-status (keyed by
    // memberClubIds). The latter is keyed by the array of member club ids;
    // setting it under the matching key makes MessagesPage's useQuery an
    // instant cache hit on cold load.
    queryClient.setQueryData(["admin-clubs", userId], b.admin_clubs);
    queryClient.setQueryData(["club-pro-status", b.member_club_ids], b.club_pro_status);
  }, [enabled, userId, query.data, queryClient]);

  return query;
}

