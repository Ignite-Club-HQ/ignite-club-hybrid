import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send, Filter, Users, CheckSquare, Square, Smartphone, Shield, Save, TestTube, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoading } from "@/components/ui/page-loading";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UserWithVersion {
  userId: string;
  name: string;
  platform: string;
  appVersion: string | null;
  buildNumber: string | null;
}

import { IcpUnavailablePage } from "@/components/IcpUnavailablePage";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

export default function SendUpdateReminderPage() {
  if (resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true)) {
    return <IcpUnavailablePage title="Update reminders are unavailable in ICP lab mode" description="Recipient selection and reminder delivery are not connected to ICP and approved external-worker services yet." />;
  }
  return <SupabaseSendUpdateReminderPage />;
}

function SupabaseSendUpdateReminderPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedClubId, setSelectedClubId] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [selectedVersions, setSelectedVersions] = useState<Set<string>>(new Set());
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [showUpdatePreview, setShowUpdatePreview] = useState(false);

  // Check app_admin
  const { data: isAppAdmin, isLoading: adminLoading } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id,
  });

  // Minimum version settings
  const [minIos, setMinIos] = useState("");
  const [minAndroid, setMinAndroid] = useState("");

  const { data: minVersionSetting } = useQuery({
    queryKey: ["min-app-version"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "minimum_app_version")
        .maybeSingle();
      return (data?.value as Record<string, string>) || { ios: "1.0.0", android: "0" };
    },
    enabled: isAppAdmin === true,
  });

  useEffect(() => {
    if (minVersionSetting) {
      setMinIos(minVersionSetting.ios || "1.0.0");
      setMinAndroid(minVersionSetting.android || "0");
    }
  }, [minVersionSetting]);

  const saveMinVersionMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("app_settings")
        .update({ value: { ios: minIos, android: minAndroid } as any, updated_at: new Date().toISOString() })
        .eq("key", "minimum_app_version");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Minimum version updated! Users on older builds will see an update prompt.");
      queryClient.invalidateQueries({ queryKey: ["min-app-version"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to save");
    },
  });

  // Fetch clubs
  const { data: clubs } = useQuery({
    queryKey: ["admin-clubs-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("id, name")
        .order("name");
      return data || [];
    },
    enabled: isAppAdmin === true,
  });

  // Fetch users via edge function (bypasses RLS on fcm_tokens)
  const { data: usersWithVersions, isLoading: usersLoading } = useQuery({
    queryKey: ["admin-users-fcm", selectedClubId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("send-update-reminder", {
        body: { action: "list-users", clubId: selectedClubId },
      });
      if (error) throw error;
      return (data?.users || []) as UserWithVersion[];
    },
    enabled: isAppAdmin === true,
  });

  // Compute latest versions per platform
  const latestVersions = useMemo(() => {
    if (!usersWithVersions) return { ios: null as string | null, android: null as string | null };
    let latestIos: string | null = null;
    let latestAndroid: string | null = null;

    for (const u of usersWithVersions) {
      const versionValue = u.platform === "android"
        ? (u.buildNumber || u.appVersion)
        : (u.appVersion || u.buildNumber);

      if (!versionValue) continue;

      if (u.platform === "ios") {
        if (!latestIos || versionValue.localeCompare(latestIos, undefined, { numeric: true }) > 0) {
          latestIos = versionValue;
        }
      } else if (u.platform === "android") {
        if (!latestAndroid || Number(versionValue) > Number(latestAndroid)) {
          latestAndroid = versionValue;
        }
      }
    }

    return { ios: latestIos, android: latestAndroid };
  }, [usersWithVersions]);

  // Platform-filtered users
  const platformFilteredUsers = useMemo(() => {
    if (!usersWithVersions) return [];
    if (platformFilter === "all") return usersWithVersions;
    return usersWithVersions.filter(u => u.platform === platformFilter);
  }, [usersWithVersions, platformFilter]);

  // Get unique versions for filter chips (scoped to platform filter)
  const versions = useMemo(() => {
    const vSet = new Set<string>();
    platformFilteredUsers.forEach(u => {
      const versionValue = u.platform === "android"
        ? (u.buildNumber || u.appVersion)
        : (u.appVersion || u.buildNumber);
      vSet.add(versionValue || "null");
    });

    return Array.from(vSet).sort((a, b) => {
      if (a === "null") return 1;
      if (b === "null") return -1;
      if (platformFilter === "android") return Number(a) - Number(b);
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }, [platformFilteredUsers, platformFilter]);

  // Filtered users (platform + version/build)
  const filteredUsers = useMemo(() => {
    if (selectedVersions.size === 0) return platformFilteredUsers;
    return platformFilteredUsers.filter(u => {
      const versionValue = u.platform === "android"
        ? (u.buildNumber || u.appVersion)
        : (u.appVersion || u.buildNumber);
      return selectedVersions.has(versionValue || "null");
    });
  }, [platformFilteredUsers, selectedVersions]);

  // Select all / none
  const toggleSelectAll = () => {
    if (selectedUserIds.size === filteredUsers.length) {
      setSelectedUserIds(new Set());
    } else {
      setSelectedUserIds(new Set(filteredUsers.map(u => u.userId)));
    }
  };

  const toggleUser = (userId: string) => {
    const next = new Set(selectedUserIds);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setSelectedUserIds(next);
  };

  // Send mutation — also auto-updates minimum_app_version to latest detected
  const sendMutation = useMutation({
    mutationFn: async (userIds: string[]) => {
      // Auto-set minimum version to latest detected so NativeAppUpdatePrompt fires
      const autoMinIos = latestVersions.ios || minIos;
      const autoMinAndroid = latestVersions.android || minAndroid;
      if (autoMinIos !== minIos || autoMinAndroid !== minAndroid) {
        const { error: settingsError } = await supabase
          .from("app_settings")
          .update({
            value: { ios: autoMinIos, android: autoMinAndroid } as any,
            updated_at: new Date().toISOString(),
          })
          .eq("key", "minimum_app_version");
        if (settingsError) {
          console.warn("Failed to auto-update minimum version:", settingsError);
        } else {
          setMinIos(autoMinIos);
          setMinAndroid(autoMinAndroid);
          queryClient.invalidateQueries({ queryKey: ["min-app-version"] });
        }
      }

      const { data, error } = await supabase.functions.invoke("send-update-reminder", {
        body: { userIds },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(data.message || "Notifications sent! Minimum version auto-updated to latest.");
      setSelectedUserIds(new Set());
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to send notifications");
    },
  });

  const resetFilters = () => {
    setSelectedUserIds(new Set());
  };

  // Send test push to myself (opens store)
  const sendTestMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Not logged in");
      const { data, error } = await supabase.functions.invoke("send-update-reminder", {
        body: { userIds: [user.id] },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(data?.message || "Test notification sent!");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to send test notification");
    },
  });

  // Send test push that triggers the update prompt dialog
  const sendPromptTestMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Not logged in");
      const { data, error } = await supabase.functions.invoke("send-update-reminder", {
        body: { userIds: [user.id], testMode: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(data?.message || "Test prompt notification sent! Tap it to see the update dialog.");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to send test notification");
    },
  });

  if (adminLoading) return <PageLoading />;
  if (!isAppAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Access Denied</h1>
        </div>
        <p className="text-muted-foreground">App admin role required.</p>
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
          <h1 className="text-2xl font-bold">Send Update Reminder</h1>
          <p className="text-sm text-muted-foreground">
            Notify native app users to update their app
          </p>
        </div>
      </div>
      {/* Send test to myself */}
      <Card className="border-dashed border-primary/40">
        <CardContent className="pt-4 pb-3 space-y-3">
          <div>
            <p className="text-sm font-medium">Test Mode</p>
            <p className="text-xs text-muted-foreground">
              Send test notifications to yourself ({user?.email}).
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 justify-start"
              disabled={sendTestMutation.isPending}
              onClick={() => sendTestMutation.mutate()}
            >
              <TestTube className="h-4 w-4" />
              {sendTestMutation.isPending ? "Sending..." : "Test: Opens Store"}
            </Button>
            <p className="text-[10px] text-muted-foreground -mt-1 ml-6">Simulates the real update reminder — tapping opens the app store.</p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 justify-start"
              disabled={sendPromptTestMutation.isPending}
              onClick={() => sendPromptTestMutation.mutate()}
            >
              <Eye className="h-4 w-4" />
              {sendPromptTestMutation.isPending ? "Sending..." : "Test: Shows Update Prompt"}
            </Button>
            <p className="text-[10px] text-muted-foreground -mt-1 ml-6">Simulates what outdated users see — tapping shows the "Update Required" popup.</p>
          </div>
        </CardContent>
      </Card>

      {/* Update prompt preview dialog */}
      <AlertDialog open={showUpdatePreview} onOpenChange={setShowUpdatePreview}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              📲 Update Required
            </AlertDialogTitle>
            <AlertDialogDescription>
              A new version of Ignite Club HQ is available with important improvements. Please update to continue using the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onClick={() => setShowUpdatePreview(false)} className="w-full">
              Update Now
            </Button>
            <Button
              variant="ghost"
              className="w-full text-xs text-muted-foreground"
              onClick={() => setShowUpdatePreview(false)}
            >
              Remind me later
            </Button>
          </AlertDialogFooter>
          <p className="text-[10px] text-center text-muted-foreground/60 -mt-2">
            This is a preview — no action will be taken.
          </p>
        </AlertDialogContent>
      </AlertDialog>

      {/* Minimum version enforcement */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Force Update Prompt
          </CardTitle>
          <CardDescription>
            Users on a version below these minimums will see an update popup every time they open the app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">iOS Minimum</Label>
              <Input
                value={minIos}
                onChange={e => setMinIos(e.target.value)}
                placeholder="e.g. 1.2.0"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Android Minimum (Build Number)</Label>
              <Input
                value={minAndroid}
                onChange={e => setMinAndroid(e.target.value)}
                placeholder="e.g. 71206710"
                className="h-9 text-sm"
              />
            </div>
          </div>
          {latestVersions.ios || latestVersions.android ? (
            <p className="text-xs text-muted-foreground">
              Tip: iOS uses semver (e.g. 1.2.6). Android uses numeric build numbers (e.g. 71206710).
            </p>
          ) : null}
          <Button
            size="sm"
            onClick={() => saveMinVersionMutation.mutate()}
            disabled={saveMinVersionMutation.isPending}
          >
            <Save className="h-4 w-4 mr-1.5" />
            {saveMinVersionMutation.isPending ? "Saving..." : "Save Minimum Versions"}
          </Button>
        </CardContent>
      </Card>

      {/* Latest versions summary */}
      {(latestVersions.ios || latestVersions.android) && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Latest Detected Versions</p>
            <div className="flex items-center gap-3">
              {latestVersions.ios && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Smartphone className="h-3 w-3" />
                  iOS: {latestVersions.ios}
                </Badge>
              )}
              {latestVersions.android && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Smartphone className="h-3 w-3" />
                  Android build: {latestVersions.android}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Club</label>
              <Select value={selectedClubId} onValueChange={(v) => {
                setSelectedClubId(v);
                resetFilters();
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="All clubs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clubs</SelectItem>
                  {clubs?.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Platform</label>
              <Select value={platformFilter} onValueChange={(v) => {
                setPlatformFilter(v);
                setSelectedVersions(new Set());
                resetFilters();
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="All platforms" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All platforms</SelectItem>
                  <SelectItem value="ios">iOS</SelectItem>
                  <SelectItem value="android">Android</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Version / Build {selectedVersions.size > 0 && `(${selectedVersions.size})`}</label>
              <div className="flex flex-wrap gap-2">
                {versions.map(v => {
                  const label = v === "null" ? "No version" : v;
                  const isSelected = selectedVersions.has(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        const next = new Set(selectedVersions);
                        if (isSelected) next.delete(v);
                        else next.add(v);
                        setSelectedVersions(next);
                        setSelectedUserIds(new Set());
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        isSelected
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-foreground border-border hover:bg-muted'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {selectedVersions.size > 0 && (
                <button
                  type="button"
                  onClick={() => { setSelectedVersions(new Set()); setSelectedUserIds(new Set()); }}
                  className="text-xs text-muted-foreground underline"
                >
                  Clear version filter
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Users list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                Users ({filteredUsers.length})
              </CardTitle>
              <CardDescription>
                {selectedUserIds.size} selected
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                {selectedUserIds.size === filteredUsers.length && filteredUsers.length > 0 ? (
                  <><Square className="h-4 w-4 mr-1" /> Deselect All</>
                ) : (
                  <><CheckSquare className="h-4 w-4 mr-1" /> Select All</>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading users...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No native app users found with current filters
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-1">
                {filteredUsers.map(u => {
                  const versionValue = u.platform === "android"
                    ? (u.buildNumber || u.appVersion)
                    : (u.appVersion || u.buildNumber);

                  return (
                    <div
                      key={u.userId}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer transition-colors"
                      onClick={() => toggleUser(u.userId)}
                    >
                      <Checkbox
                        checked={selectedUserIds.has(u.userId)}
                        onCheckedChange={() => toggleUser(u.userId)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{u.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            <Smartphone className="h-2.5 w-2.5 mr-0.5" />
                            {u.platform === 'ios' ? 'iOS' : u.platform === 'android' ? 'Android' : 'None'}
                          </Badge>
                          <Badge variant={versionValue ? "secondary" : "destructive"} className="text-[10px] px-1.5 py-0">
                            {versionValue || "No version"}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Send button */}
      <Button
        className="w-full"
        size="lg"
        disabled={selectedUserIds.size === 0 || sendMutation.isPending}
        onClick={() => sendMutation.mutate(Array.from(selectedUserIds))}
      >
        <Send className="h-5 w-5 mr-2" />
        {sendMutation.isPending
          ? "Sending..."
          : `Send Update Reminder to ${selectedUserIds.size} user${selectedUserIds.size !== 1 ? "s" : ""}`}
      </Button>
    </div>
  );
}
