import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Bell, Mail, Smartphone, Users, CheckCircle2, XCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface NotificationStats {
  totalUsers: number;
  usersWithPush: number;
  usersWithEmailEnabled: number;
}

interface UserNotificationData {
  id: string;
  display_name: string | null;
  hasPush: boolean;
  pushPlatforms: string[];
  emailMessagesEnabled: boolean;
  emailEventsEnabled: boolean;
  emailMediaEnabled: boolean;
  pushMessagesEnabled: boolean;
  pushEventsEnabled: boolean;
  pushMediaEnabled: boolean;
  pitchBoardEnabled: boolean;
}

interface NotificationPreferenceRow {
  user_id: string;
  email_messages_enabled: boolean | null;
  email_events_enabled: boolean | null;
  email_media_enabled: boolean | null;
  messages_enabled: boolean | null;
  events_enabled: boolean | null;
  media_enabled: boolean | null;
  pitch_board_enabled: boolean | null;
}

import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLivePreferencesByClub } from "@/live/features/notifications";
import { listLiveProfilesByIds } from "@/live/features/identityAccessClient";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";

export default function NotificationPreferencesPage() {
  if (isFeatureRoutedToIcp("notifications")) {
    return <IcpNotificationPreferencesPage />;
  }
  return <SupabaseNotificationPreferencesPage />;
}

interface IcpUserNotificationData {
  id: string;
  display_name: string | null;
  emailMessagesEnabled: boolean;
  emailEventsEnabled: boolean;
  emailMediaEnabled: boolean;
  pushMessagesEnabled: boolean;
  pushEventsEnabled: boolean;
  pushMediaEnabled: boolean;
}

/**
 * ICP branch: preferences come from notification_queue's paged
 * list_preferences_by_club (club filter is a canister-side no-op), display
 * names from identity_access. Push *registration* stats have no canister
 * equivalent (push delivery stays Supabase by design), so the push
 * registered column/stat is hidden rather than shown as empty.
 */
function IcpNotificationPreferencesPage() {
  const { isAppAdmin, isLoading: adminLoading } = useIsAppAdmin();

  const { data, isLoading } = useQuery({
    queryKey: ["icp-notification-preferences"],
    queryFn: async () =>
      withFeatureBackend("notifications", {
        supabase: async () => null,
        icp: async (ctx) => {
          const page = await listLivePreferencesByClub(ctx, "", 500, 0);
          const items = page.items ?? [];
          const ids = items.map((p) => p.user);
          const profiles = await listLiveProfilesByIds(ctx, ids).catch(() => []);
          const nameMap = new Map<string, string | null>(
            (profiles as any[]).map((p) => [p.id, p.display_name ?? null]),
          );
          const users: IcpUserNotificationData[] = items.map((p) => ({
            id: p.user,
            display_name: nameMap.get(p.user) ?? null,
            emailMessagesEnabled: p.email_messages_enabled,
            emailEventsEnabled: p.email_events_enabled,
            emailMediaEnabled: p.email_media_enabled,
            pushMessagesEnabled: p.messages_enabled,
            pushEventsEnabled: p.events_enabled,
            pushMediaEnabled: p.media_enabled,
          }));
          return {
            total: Number(page.total),
            usersWithEmailEnabled: users.filter((u) => u.emailMessagesEnabled).length,
            users,
          };
        },
      }),
    enabled: isAppAdmin,
  });

  if (adminLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAppAdmin) {
    return <Navigate to="/" replace />;
  }

  const users = data?.users;

  const StatusBadge = ({ enabled }: { enabled: boolean }) => (
    enabled ? (
      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        On
      </Badge>
    ) : (
      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
        <XCircle className="h-3 w-3 mr-1" />
        Off
      </Badge>
    )
  );

  return (
    <div className="space-y-6 py-4">
      <div>
        <h1 className="text-2xl font-bold">Notification Preferences</h1>
        <p className="text-muted-foreground text-sm">View user push and email notification settings</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-3 text-center">
            <Users className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
            <p className="text-2xl font-bold">{isLoading ? "-" : (data?.total ?? "-")}</p>
            <p className="text-xs text-muted-foreground">Users with Saved Preferences</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-3 text-center">
            <Mail className="h-5 w-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold">{isLoading ? "-" : (data?.usersWithEmailEnabled ?? "-")}</p>
            <p className="text-xs text-muted-foreground">Email Enabled</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Bell className="h-5 w-5" />
            User Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <Tabs defaultValue="push" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="push">Push</TabsTrigger>
                <TabsTrigger value="email">Email</TabsTrigger>
              </TabsList>

              <TabsContent value="push" className="mt-0">
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead className="text-center">Messages</TableHead>
                        <TableHead className="text-center">Schedule</TableHead>
                        <TableHead className="text-center">Media</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users?.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell className="font-medium">
                            <p className="truncate max-w-[120px]">{user.display_name || "—"}</p>
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge enabled={user.pushMessagesEnabled} />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge enabled={user.pushEventsEnabled} />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge enabled={user.pushMediaEnabled} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="email" className="mt-0">
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead className="text-center">Messages</TableHead>
                        <TableHead className="text-center">Schedule</TableHead>
                        <TableHead className="text-center">Media</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users?.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell className="font-medium">
                            <p className="truncate max-w-[120px]">{user.display_name || "—"}</p>
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge enabled={user.emailMessagesEnabled} />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge enabled={user.emailEventsEnabled} />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge enabled={user.emailMediaEnabled} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SupabaseNotificationPreferencesPage() {
  const { user } = useAuth();

  // Check if user is app_admin
  const { data: isAdmin, isLoading: adminLoading } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .single();
      return !!data;
    },
    enabled: !!user,
  });

  // Fetch notification stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["notification-stats"],
    queryFn: async (): Promise<NotificationStats> => {
      const [profilesRes, pushRes, prefsRes] = await Promise.all([
        // Fetch profile IDs (not just a head count) so we can defensively
        // dedupe preference rows against the *current* set of users. This
        // prevents duplicate preference rows or rows belonging to deleted
        // users from producing negative "email enabled" counts.
        supabase.from("profiles").select("id"),
        supabase.from("push_subscriptions").select("user_id"),
        supabase.from("notification_preferences").select("user_id, email_messages_enabled"),
      ]);

      const currentProfileIds = new Set(
        (profilesRes.data ?? [])
          .map((p) => p.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      );

      // Unique push users, scoped to current profiles, ignoring null user_ids.
      const uniquePushUsers = new Set<string>();
      for (const p of pushRes.data ?? []) {
        if (p.user_id && currentProfileIds.has(p.user_id)) {
          uniquePushUsers.add(p.user_id);
        }
      }

      // Count each user at most once. Ignore orphan rows (unknown user_id)
      // and rows with a null user_id. Missing preference row = enabled.
      const disabledCurrentUserIds = new Set<string>();
      for (const p of prefsRes.data ?? []) {
        if (!p.user_id) continue;
        if (!currentProfileIds.has(p.user_id)) continue;
        if (p.email_messages_enabled === false) {
          disabledCurrentUserIds.add(p.user_id);
        }
      }

      return {
        totalUsers: currentProfileIds.size,
        usersWithPush: uniquePushUsers.size,
        // Clamp to zero — a negative statistic should never render even if
        // upstream data is inconsistent.
        usersWithEmailEnabled: Math.max(
          0,
          currentProfileIds.size - disabledCurrentUserIds.size,
        ),
      };
    },
    enabled: !!isAdmin,
  });

  // Fetch detailed user notification data
  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ["user-notification-details"],
    queryFn: async (): Promise<UserNotificationData[]> => {
      const [profilesRes, pushRes, prefsRes] = await Promise.all([
        supabase.from("profiles").select("id, display_name").order("display_name"),
        supabase.from("push_subscriptions").select("user_id, platform"),
        supabase.from("notification_preferences").select("*"),
      ]);

      const pushByUser = new Map<string, string[]>();
      pushRes.data?.forEach(p => {
        if (!pushByUser.has(p.user_id)) {
          pushByUser.set(p.user_id, []);
        }
        pushByUser.get(p.user_id)!.push(p.platform || "web");
      });

      const prefsByUser = new Map<string, NotificationPreferenceRow>(
        (prefsRes.data ?? []).map((preference): [string, NotificationPreferenceRow] => [
          preference.user_id,
          preference,
        ]),
      );

      return (profilesRes.data || []).map(profile => {
        const prefs = prefsByUser.get(profile.id);
        const pushPlatforms = pushByUser.get(profile.id) || [];

        return {
          id: profile.id,
          display_name: profile.display_name,
          hasPush: pushPlatforms.length > 0,
          pushPlatforms: [...new Set(pushPlatforms)],
          emailMessagesEnabled: prefs?.email_messages_enabled ?? true,
          emailEventsEnabled: prefs?.email_events_enabled ?? true,
          emailMediaEnabled: prefs?.email_media_enabled ?? true,
          pushMessagesEnabled: prefs?.messages_enabled ?? true,
          pushEventsEnabled: prefs?.events_enabled ?? true,
          pushMediaEnabled: prefs?.media_enabled ?? true,
          pitchBoardEnabled: prefs?.pitch_board_enabled ?? true,
        };
      });
    },
    enabled: !!isAdmin,
  });

  if (adminLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  const isLoading = statsLoading || usersLoading;

  const StatusBadge = ({ enabled }: { enabled: boolean }) => (
    enabled ? (
      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        On
      </Badge>
    ) : (
      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
        <XCircle className="h-3 w-3 mr-1" />
        Off
      </Badge>
    )
  );

  return (
    <div className="space-y-6 py-4">
      <div>
        <h1 className="text-2xl font-bold">Notification Preferences</h1>
        <p className="text-muted-foreground text-sm">View user push and email notification settings</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-3 text-center">
            <Users className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
            <p className="text-2xl font-bold">{stats?.totalUsers ?? "-"}</p>
            <p className="text-xs text-muted-foreground">Total Users</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-3 text-center">
            <Smartphone className="h-5 w-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold">{stats?.usersWithPush ?? "-"}</p>
            <p className="text-xs text-muted-foreground">Push Enabled</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-3 text-center">
            <Mail className="h-5 w-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold">{stats?.usersWithEmailEnabled ?? "-"}</p>
            <p className="text-xs text-muted-foreground">Email Enabled</p>
          </CardContent>
        </Card>
      </div>

      {/* User Details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Bell className="h-5 w-5" />
            User Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <Tabs defaultValue="push" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="push">Push</TabsTrigger>
                <TabsTrigger value="email">Email</TabsTrigger>
              </TabsList>

              <TabsContent value="push" className="mt-0">
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead className="text-center">Registered</TableHead>
                        <TableHead className="text-center">Messages</TableHead>
                         <TableHead className="text-center">Schedule</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users?.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell className="font-medium">
                            <div>
                              <p className="truncate max-w-[120px]">{user.display_name || "—"}</p>
                              {user.hasPush && (
                                <p className="text-xs text-muted-foreground">
                                  {user.pushPlatforms.join(", ")}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge enabled={user.hasPush} />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge enabled={user.pushMessagesEnabled} />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge enabled={user.pushEventsEnabled} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="email" className="mt-0">
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead className="text-center">Messages</TableHead>
                        <TableHead className="text-center">Schedule</TableHead>
                        <TableHead className="text-center">Media</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users?.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell className="font-medium">
                            <p className="truncate max-w-[120px]">{user.display_name || "—"}</p>
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge enabled={user.emailMessagesEnabled} />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge enabled={user.emailEventsEnabled} />
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge enabled={user.emailMediaEnabled} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
