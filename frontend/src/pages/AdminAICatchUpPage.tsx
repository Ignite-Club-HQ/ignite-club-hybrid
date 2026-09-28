import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sparkles, Loader2, Search, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

interface ProClubRow {
  id: string;
  name: string;
  ai_catch_up_enabled: boolean | null;
  is_pro_football: boolean;
}

import { IcpUnavailablePage } from "@/components/IcpUnavailablePage";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

export default function AdminAICatchUpPage() {
  if (resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true)) {
    return <IcpUnavailablePage title="AI catch-up administration is unavailable in ICP lab mode" description="AI processing and provider configuration remain an approved external-worker boundary." />;
  }
  return <SupabaseAdminAICatchUpPage />;
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
