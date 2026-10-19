import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/page-loading";
import OnlineUsersTab from "@/components/admin/OnlineUsersTab";
import { useQuery } from "@tanstack/react-query";

import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabOnlineUsers } from "@/lab/fixtureDataLayer";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveOnlinePresence } from "@/live/features/club";
import { listLiveProfilesByIds } from "@/live/features/identityAccessClient";

export default function OnlineUsersPage() {
  const useIcpLab = resolveLocalAuthMode(window.location.search, true);
  if (useIcpLab) {
    return <IcpLabOnlineUsersPage />;
  }
  if (resolveAuthBackend() === "icp") {
    return <IcpOnlineUsersPage />;
  }
  return <SupabaseOnlineUsersPage />;
}

/** Read-only synthetic presence roster; realtime presence remains unavailable until messaging_domain presence is wired here. */
function IcpLabOnlineUsersPage() {
  const navigate = useNavigate();
  const users = getLocalLabOnlineUsers("club-icp-001");

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Online Users</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Showing a synthetic ICP lab presence snapshot. Realtime updates are disabled.
      </p>
      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.id} className="rounded-md border p-3 text-sm">{u.display_name}</li>
        ))}
      </ul>
    </div>
  );
}

const ONLINE_WINDOW_SECONDS = 120;

interface IcpOnlineUser {
  accountId: string;
  displayName: string | null;
  lastSeenMs: bigint;
}

/** Live roster from club_domain.list_online_presence, resolved to display names via identity_access. App-admin only canister-side. */
function IcpOnlineUsersPage() {
  const navigate = useNavigate();
  const { isAppAdmin, isLoading: isLoadingAdmin } = useIsAppAdmin();

  const { data: users, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["icp-online-presence", ONLINE_WINDOW_SECONDS],
    queryFn: async (): Promise<IcpOnlineUser[]> => {
      const rows = await withFeatureBackend("membership", {
        supabase: async () => [],
        icp: (ctx) => listLiveOnlinePresence(ctx, ONLINE_WINDOW_SECONDS),
      }, { shared: 'person' });
      if (rows.length === 0) return [];
      const profiles = await withFeatureBackend("membership", {
        supabase: async () => [],
        icp: (ctx) => listLiveProfilesByIds(ctx, rows.map((r) => r.accountId)),
      }, { shared: 'person' });
      const nameByAccount = new Map(profiles.map((p) => [p.account_id, p.display_name]));
      return rows
        .slice()
        .sort((a, b) => Number(b.lastSeenMs - a.lastSeenMs))
        .map((r) => ({
          accountId: r.accountId,
          displayName: nameByAccount.get(r.accountId) ?? null,
          lastSeenMs: r.lastSeenMs,
        }));
    },
    enabled: isAppAdmin,
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });

  if (isLoadingAdmin) return <PageLoading />;

  if (!isAppAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Online Users</h1>
        </div>
        <p className="text-muted-foreground text-center py-12">
          Access denied. App admin role required.
        </p>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Online Users</h1>
          <p className="text-sm text-muted-foreground">
            Live presence from club_domain heartbeats (last {ONLINE_WINDOW_SECONDS}s)
          </p>
        </div>
      </div>

      {isLoading ? (
        <PageLoading />
      ) : error ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-sm text-muted-foreground">Could not load online users.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            Retry
          </Button>
        </div>
      ) : !users || users.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">No one is online right now.</p>
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.accountId} className="rounded-md border p-3 text-sm flex items-center justify-between">
              <span>{u.displayName || "Unknown member"}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(Number(u.lastSeenMs)).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SupabaseOnlineUsersPage() {
  const navigate = useNavigate();

  const { isAppAdmin, isLoading } = useIsAppAdmin();

  if (isLoading) return <PageLoading />;

  if (!isAppAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Online Users</h1>
        </div>
        <p className="text-muted-foreground text-center py-12">
          Access denied. App admin role required.
        </p>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Online Users</h1>
          <p className="text-sm text-muted-foreground">
            Live presence based on app heartbeats
          </p>
        </div>
      </div>
      <OnlineUsersTab />
    </div>
  );
}
