import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/page-loading";
import OnlineUsersTab from "@/components/admin/OnlineUsersTab";

import { IcpUnavailablePage } from "@/components/IcpUnavailablePage";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabOnlineUsers } from "@/lab/fixtureDataLayer";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";

export default function OnlineUsersPage() {
  const useIcpLab = resolveLocalAuthMode(window.location.search, true);
  if (useIcpLab) {
    return <IcpLabOnlineUsersPage />;
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
