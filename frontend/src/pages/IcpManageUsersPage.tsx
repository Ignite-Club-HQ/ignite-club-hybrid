import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Trash2, Search, Shield } from "lucide-react";
import { toast } from "sonner";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import { withFeatureBackend } from "@/live/featureRouter";
import { writeOnce } from "@/live/clubScope";
import { readAdminUserDirectory, updateAdminAccountStatus } from "@/live/adminUserDirectory";
import { eraseIcpAccountAsAdmin } from "@/live/adminAccountDeletion";
import { listLiveAuditLogs } from "@/live/features/insights";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import UserAnalyticsTab from "@/components/admin/UserAnalyticsTab";
import { useAuth } from "@/hooks/useAuth";

const unavailable = async (): Promise<never> => { throw new Error("Internet Identity connection required"); };
export default function IcpManageUsersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAppAdmin, isLoading } = useIsAppAdmin();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("users");
  const [club, setClub] = useState("");
  const [team, setTeam] = useState("");
  const [role, setRole] = useState("team_member");
  const directory = useInfiniteQuery({
    queryKey: ["icp-admin-users", user?.id, query], enabled: isAppAdmin,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => withFeatureBackend("admin", { supabase: unavailable, icp: ctx => readAdminUserDirectory(ctx, query, pageParam) }, { shared: "app" }),
    getNextPageParam: page => page.next[0] ?? undefined,
  });
  const audit = useQuery({ queryKey: ["icp-admin-user-audit", user?.id], enabled: isAppAdmin && tab === "audit",
    queryFn: () => withFeatureBackend("admin", { supabase: unavailable, icp: ctx => listLiveAuditLogs(ctx, { limit: 100 }) }, { shared: "app" }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["icp-admin-users"] });
  const change = useMutation({ mutationFn: async (input: { id: string; action: "Active" | "Suspended" | "delete" }) => {
    if (input.action === "delete" && !confirm(`Permanently remove account ${input.id} and its club access? Existing shared club content is retained.`)) return false;
    await withFeatureBackend("admin", { supabase: unavailable, icp: async ctx => {
      if (input.action === "delete") await eraseIcpAccountAsAdmin(ctx.identity, ctx.target, input.id);
      else await updateAdminAccountStatus(ctx, input.id, input.action);
    } }, writeOnce({ shared: "app" }));
    return true;
  }, onSuccess: completed => { if (completed) { refresh(); toast.success("Account action completed"); } }, onError: (e: Error) => { refresh(); toast.error(e.message); } });
  const grant = useMutation({ mutationFn: async (principal: string) => {
    if (!club.trim()) throw new Error("Choose the owning club");
    const { Principal } = await import("@icp-sdk/core/principal");
    await withFeatureBackend("membership", { supabase: unavailable, icp: async ctx => {
      const { addLiveRoleGrant } = await import("@/live/features/membership");
      await addLiveRoleGrant(ctx, Principal.fromText(principal), club.trim(), role, team.trim() || null);
    } }, writeOnce({ clubId: club.trim() }));
  }, onSuccess: () => { refresh(); toast.success("Club role saved"); }, onError: (e: Error) => toast.error(e.message) });
  if (isLoading) return <Skeleton className="h-32 m-4" />;
  if (!isAppAdmin) return <p className="p-6 text-muted-foreground">App admins only.</p>;
  const users = directory.data?.pages.flatMap(page => page.items) ?? [];
  return <div className="max-w-4xl mx-auto p-4 space-y-5">
    <header className="flex items-center gap-3"><Button size="icon" variant="ghost" aria-label="Back" onClick={() => navigate(-1)}><ArrowLeft /></Button><h1 className="text-xl font-semibold">User Management</h1><Button className="ml-auto" size="icon" variant="outline" aria-label="Refresh users" onClick={() => refresh()}><RefreshCw /></Button></header>
    <Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="users">Users</TabsTrigger><TabsTrigger value="roles">Club roles</TabsTrigger><TabsTrigger value="analytics">Analytics</TabsTrigger><TabsTrigger value="audit">Audit log</TabsTrigger></TabsList>
    <TabsContent value="analytics">{tab === "analytics" && <UserAnalyticsTab />}</TabsContent>
    <TabsContent value="roles" className="space-y-3"><Input aria-label="Owning club ID" placeholder="Club ID" value={club} onChange={e => setClub(e.target.value)} /><Input aria-label="Team ID" placeholder="Team ID (optional)" value={team} onChange={e => setTeam(e.target.value)} /><Select value={role} onValueChange={setRole}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["club_admin", "team_admin", "coach", "team_member", "parent"].map(r => <SelectItem key={r} value={r}>{r.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select><div className="divide-y">{users.map(user => <div key={user.account_id} className="py-3 flex items-center justify-between gap-2"><span>{user.profile[0]?.display_name || "Member"}</span><Button size="sm" variant="outline" disabled={grant.isPending || !user.principals[0]} onClick={() => user.principals[0] && grant.mutate(user.principals[0].toText())}><Shield className="mr-2 h-4 w-4" />Assign role</Button></div>)}</div></TabsContent>
    <TabsContent value="users" className="space-y-4"><form className="flex gap-2" onSubmit={e => { e.preventDefault(); setQuery(search); }}><Input aria-label="Search users" placeholder="Name or account" value={search} onChange={e => setSearch(e.target.value)} /><Button type="submit" size="icon" aria-label="Search"><Search /></Button></form>{directory.error && <p role="alert" className="text-destructive">{directory.error.message}</p>}{directory.isPending && <Skeleton className="h-32" />}<div className="divide-y">{users.map(user => { const active = "Active" in user.status; return <div key={user.account_id} className="py-4 flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="font-medium">{user.profile[0]?.display_name || "Member"}</p><p className="text-xs text-muted-foreground break-all">{user.account_id}</p><Badge variant={active ? "secondary" : "destructive"}>{active ? "Active" : "Suspended"}</Badge></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={change.isPending} onClick={() => change.mutate({ id: user.account_id, action: active ? "Suspended" : "Active" })}>{active ? "Suspend" : "Reactivate"}</Button><Button size="icon" variant="ghost" aria-label={`Delete ${user.profile[0]?.display_name || user.account_id}`} disabled={change.isPending} onClick={() => change.mutate({ id: user.account_id, action: "delete" })}><Trash2 className="h-4 w-4" /></Button></div></div>; })}</div>{directory.hasNextPage && <Button variant="outline" disabled={directory.isFetchingNextPage} onClick={() => directory.fetchNextPage()}>Load more</Button>}</TabsContent>
    <TabsContent value="audit">{audit.error && <p role="alert" className="text-destructive">{audit.error.message}</p>}{audit.data?.items.map(row => <div key={row.id} className="border-b py-3"><p>{row.action_type}</p><p className="text-xs text-muted-foreground">{new Date(Number(row.created_at_ms)).toLocaleString()}</p></div>)}</TabsContent>
    </Tabs>
  </div>;
}