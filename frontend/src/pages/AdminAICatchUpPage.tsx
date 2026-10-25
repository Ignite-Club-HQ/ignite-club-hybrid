import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Loader2, Search, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import { readMembershipInScope } from "@/live/membershipRouting";
import { writeOnce } from "@/live/clubScope";
import { readAdminProCatchUpClubs, enableAdminProCatchUpClubs } from "@/live/adminAiCatchUpOperations";

interface ProClubRow {
  id: string;
  name: string;
  ai_catch_up_enabled: boolean | null;
  is_pro_football: boolean;
}

const ICP_SETTING_KEY = "ai_catch_up_global_rollout_enabled";

export default function AdminAICatchUpPage() {
  const { isAppAdmin, isLoading } = useIsAppAdmin();
  const isIcp = resolveAuthBackend() === "icp";
  if (isLoading) return <div className="p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!isAppAdmin) return <p className="p-6 text-muted-foreground">Access denied. App admin role required.</p>;
  if (isIcp) {
    return <IcpAdminAICatchUpPage />;
  }
  return <SupabaseAdminAICatchUpPage />;
}

function IcpAdminAICatchUpPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "selected">("selected");
  const [unconfirmed, setUnconfirmed] = useState(false);

  const { data: enabled, isLoading, error: settingError } = useQuery({
    queryKey: ["icp-ai-catch-up-rollout-setting"],
    queryFn: () =>
      withFeatureBackend("admin", {
        supabase: async () => { throw new Error("Internet Identity connection required"); },
        icp: async (ctx) => {
          const { getLiveAppSetting, decodeAppSettingBool } = await import("@/live/features/appSettings");
          const raw = await getLiveAppSetting(ctx, ICP_SETTING_KEY);
          return decodeAppSettingBool(raw, false);
        },
      }),
  });

  const updateMutation = useMutation({
    mutationFn: async (value: boolean) =>
      withFeatureBackend("admin", {
        supabase: async () => { throw new Error("Internet Identity connection required"); },
        icp: async (ctx) => {
          const { setLiveAppSetting } = await import("@/live/features/appSettings");
          await setLiveAppSetting(ctx, ICP_SETTING_KEY, value);
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["icp-ai-catch-up-rollout-setting"] });
      toast.success("Setting updated");
    },
    onError: (e: Error) => toast.error("Failed to update: " + e.message),
  });

  // Pro clubs list (club_domain is the source of truth for clubs + Pro
  // status on ICP) joined with each club's AI catch-up flag from
  // messaging_domain's club DM settings.
  const { data: clubs = [], isLoading: isLoadingClubs, error: clubsError, refetch } = useQuery({
    queryKey: ["icp-admin-pro-clubs-ai-catchup"],
    queryFn: () => Promise.race([
      readAdminProCatchUpClubs(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the club list took too long to load")), 30_000)),
    ]),
    staleTime: 60_000,
    retry: 1,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clubs;
    return clubs.filter((c) => c.name.toLowerCase().includes(q));
  }, [clubs, search]);

  const enableMutation = useMutation({
    retry: false,
    mutationFn: (payload: { all: boolean; ids: string[] }) => enableAdminProCatchUpClubs(payload.all ? clubs.map(c => c.id) : payload.ids, payload.all),
    onSuccess: (r) => {
      toast.success(
        `Enabled on ${r.total_pro_clubs} Pro club${r.total_pro_clubs === 1 ? "" : "s"} · ${r.members_updated} member${r.members_updated === 1 ? "" : "s"} switched on`
      );
      setConfirmOpen(false);
      setSelected(new Set());
      refetch();
    },
    onError: (e: Error) => { if (e.message.includes("unconfirmed")) setUnconfirmed(true); toast.error("Failed: " + e.message); },
  });

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    const allSelected = filtered.every((c) => selected.has(c.id));
    setSelected((s) => {
      const next = new Set(s);
      filtered.forEach((c) => (allSelected ? next.delete(c.id) : next.add(c.id)));
      return next;
    });
  };

  const openConfirm = (s: "all" | "selected") => {
    if (unconfirmed || clubsError || isLoadingClubs) return;
    if (s === "selected" && selected.size === 0) {
      toast.error("Select at least one club");
      return;
    }
    setScope(s);
    setConfirmOpen(true);
  };

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="gap-2">
        <ArrowLeft className="h-4 w-4" /> Back to Admin
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Chat Recap Rollout
          </CardTitle>
          <CardDescription>
            Global rollout flag for AI Chat Recap on the Internet Computer backend. Per-club
            enablement and member opt-out remain available from each club's own settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settingError ? (
            <p role="alert" className="text-destructive">Could not load rollout setting: {settingError.message}</p>
          ) : isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="rollout-enabled" className="text-base">
                  Enable AI Chat Recap rollout
                </Label>
                <p className="text-xs text-muted-foreground">
                  Turns the feature on as the default for clubs on the Internet Computer backend.
                </p>
              </div>
              <Switch
                id="rollout-enabled"
                checked={!!enabled}
                disabled={updateMutation.isPending}
                onCheckedChange={(v) => updateMutation.mutate(v)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Bulk-enable for Pro clubs
          </CardTitle>
          <CardDescription>
            Turn on AI Chat Recap across Pro clubs. This enables it at the club level and
            switches it on for every member's profile. Members can still turn it off in their own
            Settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              onClick={() => openConfirm("all")}
              disabled={enableMutation.isPending || clubs.length === 0 || unconfirmed || !!clubsError}
            >
              Enable for ALL Pro clubs ({clubs.length})
            </Button>
            <Button
              variant="outline"
              onClick={() => openConfirm("selected")}
              disabled={enableMutation.isPending || selected.size === 0 || unconfirmed || !!clubsError}
            >
              Enable for selected ({selected.size})
            </Button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search Pro clubs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {unconfirmed && <p role="alert" className="text-destructive">An update is unconfirmed. Further batch changes are paused.</p>}
          {clubsError ? (
            <div className="py-6 text-center space-y-3">
              <p className="text-sm text-muted-foreground">Could not load Pro clubs right now ({clubsError.message}).</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
            </div>
          ) : isLoadingClubs ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No Pro clubs found.</p>
          ) : (
            <div className="border rounded-md divide-y">
              <div className="flex items-center gap-3 p-3 bg-muted/40">
                <Checkbox
                  checked={filtered.length > 0 && filtered.every((c) => selected.has(c.id))}
                  onCheckedChange={toggleAllVisible}
                />
                <span className="text-sm font-medium">Select all visible</span>
              </div>
              {filtered.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/40"
                >
                  <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{c.name}</span>
                      {c.is_pro_football && <Badge variant="secondary">Pro Football</Badge>}
                    </div>
                  </div>
                  {c.ai_catch_up_enabled ? (
                    <Badge className="bg-green-600 hover:bg-green-600">On</Badge>
                  ) : (
                    <Badge variant="outline">Off</Badge>
                  )}
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {scope === "all"
                ? `Enable AI Chat Recap on all ${clubs.length} Pro clubs?`
                : `Enable AI Chat Recap on ${selected.size} selected club${selected.size === 1 ? "" : "s"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This switches the feature on at the club level and on every member's individual
              profile in those clubs. Members can opt out again from their own Settings at any
              time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enableMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                enableMutation.mutate({
                  all: scope === "all",
                  ids: Array.from(selected),
                });
              }}
              disabled={enableMutation.isPending}
            >
              {enableMutation.isPending ? "Enabling..." : "Enable"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
function SupabaseAdminAICatchUpPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "selected">("selected");

  const { data: clubs = [], isLoading, refetch } = useQuery({
    queryKey: ["admin-pro-clubs-ai-catchup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select(
          "id, name, ai_catch_up_enabled, club_subscriptions(is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at)"
        )
        .order("name");
      if (error) throw error;
      const now = Date.now();
      return ((data as any[]) ?? [])
        .map((c) => {
          const sub = Array.isArray(c.club_subscriptions) ? c.club_subscriptions[0] : c.club_subscriptions;
          if (!sub) return null;
          const isPro = sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override;
          const active = !sub.expires_at || new Date(sub.expires_at).getTime() > now;
          if (!isPro || !active) return null;
          return {
            id: c.id,
            name: c.name,
            ai_catch_up_enabled: c.ai_catch_up_enabled,
            is_pro_football: !!(sub.is_pro_football || sub.admin_pro_football_override),
          } as ProClubRow;
        })
        .filter(Boolean) as ProClubRow[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clubs;
    return clubs.filter((c) => c.name.toLowerCase().includes(q));
  }, [clubs, search]);

  const enableMutation = useMutation({
    mutationFn: async (payload: { all: boolean; ids: string[] }) => {
      const args = payload.all ? {} : { p_club_ids: payload.ids };
      const { data, error } = await supabase.rpc(
        "app_admin_enable_ai_catch_up_for_pro_clubs" as any,
        args
      );
      if (error) throw error;
      return data as { clubs_updated: number; members_updated: number; total_pro_clubs: number };
    },
    onSuccess: (r) => {
      toast.success(
        `Enabled on ${r.total_pro_clubs} Pro club${r.total_pro_clubs === 1 ? "" : "s"} · ${r.members_updated} member${r.members_updated === 1 ? "" : "s"} switched on`
      );
      setConfirmOpen(false);
      setSelected(new Set());
      refetch();
    },
    onError: (e: Error) => toast.error("Failed: " + e.message),
  });

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    const allSelected = filtered.every((c) => selected.has(c.id));
    setSelected((s) => {
      const next = new Set(s);
      filtered.forEach((c) => (allSelected ? next.delete(c.id) : next.add(c.id)));
      return next;
    });
  };

  const openConfirm = (s: "all" | "selected") => {
    if (s === "selected" && selected.size === 0) {
      toast.error("Select at least one club");
      return;
    }
    setScope(s);
    setConfirmOpen(true);
  };

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="gap-2">
        <ArrowLeft className="h-4 w-4" /> Back to Admin
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Chat Recap Rollout
          </CardTitle>
          <CardDescription>
            Turn on AI Chat Recap across Pro clubs. This enables it at the club level and
            switches it on for every member's profile. Members can still turn it off in their own
            Settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              onClick={() => openConfirm("all")}
              disabled={enableMutation.isPending || clubs.length === 0}
            >
              Enable for ALL Pro clubs ({clubs.length})
            </Button>
            <Button
              variant="outline"
              onClick={() => openConfirm("selected")}
              disabled={enableMutation.isPending || selected.size === 0}
            >
              Enable for selected ({selected.size})
            </Button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search Pro clubs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No Pro clubs found.</p>
          ) : (
            <div className="border rounded-md divide-y">
              <div className="flex items-center gap-3 p-3 bg-muted/40">
                <Checkbox
                  checked={filtered.length > 0 && filtered.every((c) => selected.has(c.id))}
                  onCheckedChange={toggleAllVisible}
                />
                <span className="text-sm font-medium">Select all visible</span>
              </div>
              {filtered.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/40"
                >
                  <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{c.name}</span>
                      {c.is_pro_football && <Badge variant="secondary">Pro Football</Badge>}
                    </div>
                  </div>
                  {c.ai_catch_up_enabled ? (
                    <Badge className="bg-green-600 hover:bg-green-600">On</Badge>
                  ) : (
                    <Badge variant="outline">Off</Badge>
                  )}
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {scope === "all"
                ? `Enable AI Chat Recap on all ${clubs.length} Pro clubs?`
                : `Enable AI Chat Recap on ${selected.size} selected club${selected.size === 1 ? "" : "s"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This switches the feature on at the club level and on every member's individual
              profile in those clubs. Members can opt out again from their own Settings at any
              time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enableMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                enableMutation.mutate({
                  all: scope === "all",
                  ids: Array.from(selected),
                });
              }}
              disabled={enableMutation.isPending}
            >
              {enableMutation.isPending ? "Enabling..." : "Enable"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
