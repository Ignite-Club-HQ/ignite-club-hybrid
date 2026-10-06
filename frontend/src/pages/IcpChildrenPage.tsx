import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, UserPlus, Loader2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
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
import { useToast } from "@/hooks/use-toast";

/**
 * Children page for secure sign-in (ICP) users. Child records live on
 * club_domain (no names); names are encrypted on pii_access_control
 * (pii_id = child id, field "name"). All ICP modules load lazily.
 */

interface IcpChild {
  id: string;
  name: string;
  teams: string[];
  isPrimary: boolean;
}
interface TeamOpt { id: string; name: string; club_id: string; club_name: string }
interface Guardian { principal: string; name: string; isPrimary: boolean; isMe: boolean }

async function load() {
  const [{ icpCtx }, club, vault] = await Promise.all([
    import("@/lib/icpClubTeamLookup"),
    import("@/live/features/club"),
    import("@/live/features/vault"),
  ]);
  return { ctx: await icpCtx(), club, vault };
}

const KEY = ["icp-own-children"];

export default function IcpChildrenPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [teamFor, setTeamFor] = useState<IcpChild | null>(null);
  const [guardiansFor, setGuardiansFor] = useState<IcpChild | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: children, isLoading } = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<IcpChild[]> => {
      const { ctx, club, vault } = await load();
      const me = ctx.identity.getPrincipal().toText();
      const rows = (await club.listMyLiveOwnChildren(ctx)) as any[];
      const names = await vault.resolveLivePiiTextBatch(ctx, rows.map((r) => r.id), "name", "read", "children_page");
      return rows.map((r) => ({
        id: r.id,
        name: names.get(r.id) ?? "Child",
        teams: r.teams as string[],
        isPrimary: r.parent?.[0]?.toText?.() === me,
      }));
    },
  });

  const { data: teams } = useQuery({
    queryKey: ["icp-children-teams"],
    queryFn: async (): Promise<TeamOpt[]> => {
      const { icpListClubs, icpListTeams } = await import("@/lib/icpClubTeamLookup");
      const { ctx } = await load();
      const membership = await import("@/live/features/membership");
      const grants = (await membership.getLiveMyRoleGrants(ctx).catch(() => [])) as any[];
      const myClubIds = new Set(grants.map((g) => g.club?.[0]).filter(Boolean));
      const clubs = (await icpListClubs()).filter((c) => myClubIds.has(c.id));
      const lists = await Promise.all(
        clubs.map(async (c) =>
          (await icpListTeams(c.id).catch(() => [])).map((t) => ({ id: t.id, name: t.name, club_id: c.id, club_name: c.name })),
        ),
      );
      return lists.flat();
    },
  });
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ["children"] });
    qc.invalidateQueries({ queryKey: ["own_children"] });
  };

  const addChild = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Enter a name");
      if ((children ?? []).some((c) => c.isPrimary && c.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new Error(`${trimmed} is already in your children list.`);
      }
      const { ctx, club, vault } = await load();
      const child = await club.createMyLiveChild(ctx);
      const me = ctx.identity.getPrincipal();
      await vault.registerLiveChildNamePii(ctx, child.id, trimmed, me);
    },
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
      setName("");
      toast({ title: "Child added successfully" });
    },
    onError: (e: any) => toast({ title: "Failed to add child", description: e?.message, variant: "destructive" }),
  });

  const deleteChild = useMutation({
    mutationFn: async (id: string) => {
      const { ctx, club } = await load();
      await club.deleteMyLiveChild(ctx, id);
    },
    onSuccess: () => { invalidate(); setDeleteId(null); toast({ title: "Child removed" }); },
    onError: (e: any) => toast({ title: "Failed to remove child", description: e?.message, variant: "destructive" }),
  });

  const setTeam = useMutation({
    mutationFn: async ({ child, teamId, assigned }: { child: IcpChild; teamId: string; assigned: boolean }) => {
      const { ctx, club, vault } = await load();
      await club.setMyLiveChildTeam(ctx, child.id, teamId, assigned);
      const t = teamById.get(teamId);
      // Let club staff see the name on rosters (best effort).
      if (assigned && t) await vault.grantLiveClubChildNameRead(ctx, child.id, t.club_id).catch(() => {});
    },
    onSuccess: (_d, v) => { invalidate(); toast({ title: v.assigned ? "Added to team" : "Removed from team" }); },
    onError: (e: any) => toast({ title: "Failed to update team", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold">Children</h1>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add child
        </Button>
      </div>

      {isLoading ? (
        <div className="py-10 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading children...</p>
        </div>
      ) : !children?.length ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <Users className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground">No children added yet.</p>
            <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add your first child</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {children.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{c.name}</p>
                    {!c.isPrimary && <p className="text-xs text-muted-foreground">You're a guardian</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" aria-label="Guardians" onClick={() => setGuardiansFor(c)}>
                      <UserPlus className="h-4 w-4" />
                    </Button>
                    {c.isPrimary && (
                      <Button variant="ghost" size="icon" aria-label="Remove child" onClick={() => setDeleteId(c.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {c.teams.map((tid) => {
                    const t = teamById.get(tid);
                    return (
                      <Badge key={tid} variant="secondary" className="gap-1">
                        {t ? `${t.name} · ${t.club_name}` : "Team"}
                        <button
                          aria-label="Remove from team"
                          onClick={() => setTeam.mutate({ child: c, teamId: tid, assigned: false })}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                  <Button variant="outline" size="sm" onClick={() => setTeamFor(c)}>
                    <Plus className="h-3 w-3 mr-1" /> Add to team
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ResponsiveDialog open={addOpen} onOpenChange={setAddOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader><ResponsiveDialogTitle>Add child</ResponsiveDialogTitle></ResponsiveDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="icp-child-name">Name</Label>
            <Input id="icp-child-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Child's name" />
            <p className="text-xs text-muted-foreground">The name is stored privately and only shown to you, other guardians and their clubs.</p>
          </div>
          <ResponsiveDialogFooter>
            <Button onClick={() => addChild.mutate()} disabled={!name.trim() || addChild.isPending}>
              {addChild.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Add child
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog open={!!teamFor} onOpenChange={(o) => !o && setTeamFor(null)}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader><ResponsiveDialogTitle>Add {teamFor?.name} to a team</ResponsiveDialogTitle></ResponsiveDialogHeader>
          <div className="space-y-2 py-2 max-h-[60vh] overflow-y-auto">
            {(teams ?? []).filter((t) => !teamFor?.teams.includes(t.id)).map((t) => (
              <Button
                key={t.id}
                variant="outline"
                className="w-full justify-start"
                disabled={setTeam.isPending}
                onClick={() => { setTeam.mutate({ child: teamFor!, teamId: t.id, assigned: true }); setTeamFor(null); }}
              >
                {t.name} <span className="ml-2 text-xs text-muted-foreground">{t.club_name}</span>
              </Button>
            ))}
            {teams && teams.filter((t) => !teamFor?.teams.includes(t.id)).length === 0 && (
              <p className="text-sm text-muted-foreground">No other teams in your clubs.</p>
            )}
            {!teams && <Loader2 className="h-5 w-5 animate-spin mx-auto" />}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {guardiansFor && (
        <GuardiansDialog child={guardiansFor} teamIds={guardiansFor.teams} onClose={() => setGuardiansFor(null)} onChanged={invalidate} />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove child?</AlertDialogTitle>
            <AlertDialogDescription>This removes the child from your account, their teams and other guardians.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteChild.mutate(deleteId)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GuardiansDialog({ child, teamIds, onClose, onChanged }: { child: IcpChild; teamIds: string[]; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["icp-child-guardians", child.id];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { ctx, club } = await load();
      const { listLiveProfilesByIds, accountIdForPrincipal } = await import("@/live/features/identityAccessClient");
      const { listLiveTeamRoleGrants } = await import("@/live/features/membership");
      const me = ctx.identity.getPrincipal().toText();
      const principals = ((await club.listLiveChildGuardians(ctx, child.id)) as any[]).map((p) => p.toText());
      // Candidates: members of the child's teams.
      const grants = (await Promise.all(teamIds.map((t) => listLiveTeamRoleGrants(ctx, t).catch(() => [])))).flat() as any[];
      const candidates = Array.from(new Set(grants.map((g) => g.user?.toText?.()).filter(Boolean))) as string[];
      const all = Array.from(new Set([...principals, ...candidates]));
      const accIds = await Promise.all(all.map((p) => accountIdForPrincipal(p)));
      const profiles = (await listLiveProfilesByIds(ctx, accIds.filter(Boolean) as string[]).catch(() => [])) as any[];
      const nameByAcc = new Map(profiles.map((p) => [p.account_id, p.display_name]));
      const nameOf = (p: string) => {
        if (p === me) return "You";
        const a = accIds[all.indexOf(p)];
        return (a && nameByAcc.get(a)) || "Member";
      };
      const guardians: Guardian[] = principals.map((p) => ({
        principal: p,
        name: nameOf(p),
        isPrimary: p === me ? child.isPrimary : false,
        isMe: p === me,
      }));
      const addable = candidates.filter((p) => !principals.includes(p) && p !== me).map((p) => ({ principal: p, name: nameOf(p) }));
      return { guardians, addable };
    },
  });

  const change = useMutation({
    mutationFn: async ({ principal, linked }: { principal: string; linked: boolean }) => {
      const { ctx, club, vault } = await load();
      const { Principal } = await import("@icp-sdk/core/principal");
      const p = Principal.fromText(principal);
      await club.setMyLiveChildGuardian(ctx, child.id, p, linked);
      if (linked) await vault.grantLiveGuardianChildNameRead(ctx, child.id, p);
      else await vault.revokeLivePiiRead(ctx, child.id, "name", p).catch(() => {});
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: key });
      onChanged();
      toast({ title: v.linked ? "Guardian added" : "Guardian removed" });
      if (!v.linked && data?.guardians.find((g) => g.principal === v.principal)?.isMe) onClose();
    },
    onError: (e: any) => toast({ title: "Couldn't update guardians", description: e?.message, variant: "destructive" }),
  });

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader><ResponsiveDialogTitle>Guardians for {child.name}</ResponsiveDialogTitle></ResponsiveDialogHeader>
        {isLoading || !data ? (
          <Loader2 className="h-5 w-5 animate-spin mx-auto my-6" />
        ) : (
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              {data.guardians.map((g) => (
                <div key={g.principal} className="flex items-center justify-between rounded-md border p-2">
                  <span className="text-sm">{g.name}{g.isPrimary && <span className="ml-2 text-xs text-muted-foreground">Primary parent</span>}</span>
                  {((child.isPrimary && !g.isMe) || (!child.isPrimary && g.isMe)) && (
                    <Button variant="ghost" size="sm" disabled={change.isPending} onClick={() => change.mutate({ principal: g.principal, linked: false })}>
                      {g.isMe ? "Leave" : "Remove"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {child.isPrimary && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Add a guardian from {child.name}'s teams</p>
                {data.addable.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {teamIds.length ? "No other team members to add." : "Add the child to a team first, then pick the other parent from that team."}
                  </p>
                ) : (
                  data.addable.map((m) => (
                    <div key={m.principal} className="flex items-center justify-between rounded-md border p-2">
                      <span className="text-sm">{m.name}</span>
                      <Button size="sm" variant="outline" disabled={change.isPending} onClick={() => change.mutate({ principal: m.principal, linked: true })}>
                        Add
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
