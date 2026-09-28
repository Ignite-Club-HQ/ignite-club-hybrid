import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Network, Loader2, Building2, Users, CalendarDays, Megaphone, Send, Plus, X, Trophy, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { AssociationEventsPanel } from "@/components/AssociationEventsPanel";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabAssociationDetail } from "@/lab/fixtureDataLayer";

export default function AssociationDetailPage() {
  usePageTitle("Association");
  const navigate = useNavigate();
  const { associationId } = useParams<{ associationId: string }>();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    const association = getLocalLabAssociationDetail(associationId ?? "association-icp-001");
    return (
      <div className="container max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/associations")} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold">{association?.name ?? "Association"}</h1>
        </div>
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 space-y-4 text-center">
            <Network className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Showing a synthetic ICP lab association. Linked clubs, rollups, events, broadcasts, competitions, and
              membership changes remain unavailable until an association_domain service is built and wired here.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabaseAssociationDetailPage />;
}

function SupabaseAssociationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const { data: assoc, isLoading } = useQuery({
    queryKey: ["association", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from("clubs").select("*").eq("id", id!).maybeSingle();
      return data;
    },
  });

  const { data: isAdmin = false } = useQuery({
    queryKey: ["assoc-isadmin", id, user?.id],
    enabled: !!id && !!user,
    queryFn: async () => {
      const { data } = await supabase.rpc("is_association_admin", {
        _user_id: user!.id,
        _association_id: id!,
      });
      return !!data;
    },
  });

  const { data: clubs = [] } = useQuery({
    queryKey: ["association-clubs", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("id, name, logo_url, city, kind")
        .eq("parent_org_id", id!)
        .order("name");
      return data ?? [];
    },
  });

  const clubIds = clubs.map((c: any) => c.id);

  const { data: rollup } = useQuery({
    queryKey: ["association-rollup", id, clubIds.length],
    enabled: !!id && clubIds.length > 0,
    queryFn: async () => {
      const [teamsRes, eventsRes, membersRes] = await Promise.all([
        supabase.from("teams").select("id", { count: "exact", head: true }).in("club_id", clubIds),
        supabase
          .from("events")
          .select("id", { count: "exact", head: true })
          .in("club_id", clubIds)
          .gte("start_at", new Date().toISOString())
          .lte("start_at", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()),
        supabase.from("user_roles").select("user_id", { count: "exact", head: true }).in("club_id", clubIds),
      ]);
      return {
        teams: teamsRes.count ?? 0,
        upcomingEvents: eventsRes.count ?? 0,
        members: membersRes.count ?? 0,
      };
    },
  });

  if (isLoading) {
    return <div className="p-6 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!assoc) {
    return <div className="p-6 text-center text-sm text-muted-foreground">Association not found.</div>;
  }

  return (
    <div className="container max-w-3xl mx-auto px-4 py-6 space-y-5">
      <Button asChild variant="ghost" size="sm">
        <Link to="/associations"><ArrowLeft className="h-4 w-4 mr-1" /> Associations</Link>
      </Button>

      <header className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-3"><Network className="h-6 w-6 text-primary" /></div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{assoc.name}</h1>
          <p className="text-sm text-muted-foreground">Association</p>
          {isAdmin && <Badge className="mt-2">Admin</Badge>}
        </div>
      </header>

      {assoc.description && (
        <p className="text-sm whitespace-pre-wrap">{assoc.description}</p>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="clubs">Member clubs</TabsTrigger>
          <TabsTrigger value="playhq">PlayHQ</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          {isAdmin && <TabsTrigger value="broadcasts">Broadcasts</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <StatCard icon={Building2} label="Clubs" value={clubs.length} />
            <StatCard icon={Users} label="Members" value={rollup?.members ?? 0} />
            <StatCard icon={CalendarDays} label="Next 7d events" value={rollup?.upcomingEvents ?? 0} />
          </div>
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              <p>Teams under association: <span className="font-medium text-foreground">{rollup?.teams ?? 0}</span></p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="clubs" className="space-y-3">
          {isAdmin && <LinkClubForm associationId={id!} />}
          {clubs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No clubs linked yet.</p>
          ) : (
            clubs.map((c: any) => (
              <Card key={c.id}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{[c.city, c.kind].filter(Boolean).join(" · ")}</div>
                  </div>
                  {isAdmin && <UnlinkClubButton clubId={c.id} associationId={id!} />}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="playhq" className="space-y-3">
          <PlayHQPanel associationId={id!} isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="events" className="space-y-3">
          <AssociationEventsPanel associationId={id!} isAdmin={isAdmin} clubs={clubs} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="broadcasts" className="space-y-3">
            <BroadcastsPanel associationId={id!} clubs={clubs} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3 text-center">
        <Icon className="h-4 w-4 mx-auto text-muted-foreground" />
        <div className="text-xl font-bold mt-1">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function LinkClubForm({ associationId }: { associationId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [clubId, setClubId] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: clubs = [] } = useQuery({
    queryKey: ["link-club-search", search, associationId],
    enabled: open,
    queryFn: async () => {
      let q = supabase
        .from("clubs")
        .select("id, name, city")
        .eq("kind", "full")
        .is("parent_org_id", null)
        .order("name")
        .limit(50);
      if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
      const { data } = await q;
      return data ?? [];
    },
  });

  const link = async () => {
    if (!clubId) return;
    setSaving(true);
    const { error } = await supabase.from("clubs").update({ parent_org_id: associationId }).eq("id", clubId);
    setSaving(false);
    if (error) {
      toast({ title: "Could not link club", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Club linked" });
    setClubId(""); setOpen(false);
    qc.invalidateQueries({ queryKey: ["association-clubs", associationId] });
    qc.invalidateQueries({ queryKey: ["association-rollup", associationId] });
  };

  if (!open) {
    return <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Link club</Button>;
  }
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div>
          <Label>Find club</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" />
        </div>
        <div>
          <Label>Club</Label>
          <Select value={clubId} onValueChange={setClubId}>
            <SelectTrigger><SelectValue placeholder="Select club" /></SelectTrigger>
            <SelectContent>
              {clubs.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}{c.city ? ` — ${c.city}` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">Only unaffiliated full clubs are shown.</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={link} disabled={!clubId || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Link"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function UnlinkClubButton({ clubId, associationId }: { clubId: string; associationId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const unlink = async () => {
    const ok = window.confirm("Remove this club from the association?");
    if (!ok) return;
    const { error } = await supabase.from("clubs").update({ parent_org_id: null }).eq("id", clubId);
    if (error) {
      toast({ title: "Could not unlink", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Club unlinked" });
    qc.invalidateQueries({ queryKey: ["association-clubs", associationId] });
    qc.invalidateQueries({ queryKey: ["association-rollup", associationId] });
  };
  return (
    <Button variant="ghost" size="sm" onClick={unlink} aria-label="Unlink club">
      <X className="h-4 w-4" />
    </Button>
  );
}

function BroadcastsPanel({ associationId, clubs }: { associationId: string; clubs: any[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [selectedClubIds, setSelectedClubIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  const { data: history = [] } = useQuery({
    queryKey: ["association-broadcasts", associationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("association_broadcasts")
        .select("*")
        .eq("association_id", associationId)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const toggleClub = (cid: string) => {
    setSelectedClubIds((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid); else next.add(cid);
      return next;
    });
  };

  const send = async () => {
    if (!message.trim()) return;
    setSending(true);
    const { data, error } = await supabase.functions.invoke("send-association-broadcast", {
      body: {
        association_id: associationId,
        message: message.trim(),
        club_ids: selectedClubIds.size > 0 ? Array.from(selectedClubIds) : null,
      },
    });
    setSending(false);
    if (error || (data as any)?.error) {
      toast({ title: "Could not send broadcast", description: (data as any)?.error || error?.message, variant: "destructive" });
      return;
    }
    const d = data as any;
    toast({ title: `Sent to ${d.recipient_team_count} team${d.recipient_team_count === 1 ? "" : "s"} across ${d.recipient_club_count} club${d.recipient_club_count === 1 ? "" : "s"}` });
    setMessage("");
    setSelectedClubIds(new Set());
    qc.invalidateQueries({ queryKey: ["association-broadcasts", associationId] });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-primary" />
            <span className="font-medium">Send broadcast</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Posts as an association announcement in the team chat of every team under{selectedClubIds.size > 0 ? " the selected clubs." : " every member club."}
          </p>
          <div>
            <Label>Message</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="e.g. Reminder: registration closes Friday." />
          </div>
          {clubs.length > 0 && (
            <div className="space-y-1.5">
              <Label>Limit to clubs (optional)</Label>
              <div className="border rounded-lg p-2 space-y-1 max-h-40 overflow-y-auto">
                {clubs.map((c: any) => (
                  <label key={c.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm">
                    <Checkbox checked={selectedClubIds.has(c.id)} onCheckedChange={() => toggleClub(c.id)} />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{clubs.length} member club{clubs.length === 1 ? "" : "s"} total</span>
            <Button size="sm" onClick={send} disabled={!message.trim() || sending || clubs.length === 0}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Send
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="text-sm font-medium">Recent broadcasts</div>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No broadcasts yet.</p>
        ) : (
          history.map((b: any) => (
            <Card key={b.id}>
              <CardContent className="p-4 space-y-1">
                <div className="text-sm whitespace-pre-wrap">{b.message}</div>
                <div className="text-xs text-muted-foreground">
                  {b.recipient_team_count} team{b.recipient_team_count === 1 ? "" : "s"} · {formatDistanceToNow(new Date(b.created_at), { addSuffix: true })}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function PlayHQPanel({ associationId, isAdmin }: { associationId: string; isAdmin: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [tenant, setTenant] = useState("");
  const [sport, setSport] = useState("");
  const [season, setSeason] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: comps = [], isLoading } = useQuery({
    queryKey: ["association-playhq-comps", associationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("competitions")
        .select("id, name, sport, season, status, external_tenant, last_synced_at")
        .eq("organizer_club_id", associationId)
        .eq("source", "playhq")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // Extract the last UUID-like or id-like segment from a PlayHQ URL
  const parseExternalId = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Try UUID pattern anywhere in URL
    const uuid = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuid) return uuid[0];
    // Fallback: last non-empty path segment
    try {
      const u = new URL(trimmed);
      const segs = u.pathname.split("/").filter(Boolean);
      return segs[segs.length - 1] ?? null;
    } catch {
      return trimmed;
    }
  };

  const handleLink = async () => {
    if (!user || !name.trim() || !url.trim() || !tenant.trim()) {
      toast({ title: "Missing details", description: "Name, PlayHQ URL and tenant are required.", variant: "destructive" });
      return;
    }
    const extId = parseExternalId(url);
    if (!extId) {
      toast({ title: "Couldn't read PlayHQ URL", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("competitions")
      .insert({
        name: name.trim(),
        sport: sport.trim() || null,
        season: season.trim() || null,
        organizer_club_id: associationId,
        visibility: "public",
        status: "active",
        created_by: user.id,
        source: "playhq",
        external_id: extId,
        external_tenant: tenant.trim().toLowerCase(),
      })
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) {
      toast({ title: "Could not link PlayHQ competition", description: error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "PlayHQ competition linked" });
    setName(""); setUrl(""); setTenant(""); setSport(""); setSeason(""); setOpen(false);
    qc.invalidateQueries({ queryKey: ["association-playhq-comps", associationId] });
    navigate(`/competitions/${data.id}`);
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            <span className="font-medium">PlayHQ competitions</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Link a PlayHQ-sourced competition (ladder, fixtures and results) to this association. Data is read-only and mirrored from PlayHQ.
          </p>
          {isAdmin && !open && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Link PlayHQ competition
            </Button>
          )}
          {isAdmin && open && (
            <div className="space-y-3 pt-2">
              <div>
                <Label>Display name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. U12 Saturday League 2026" />
              </div>
              <div>
                <Label>PlayHQ URL</Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://reference.invalid" />
                <p className="text-[11px] text-muted-foreground mt-1">Paste the PlayHQ grade or competition page URL.</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>Tenant</Label>
                  <Input value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="bv" />
                </div>
                <div>
                  <Label>Sport</Label>
                  <Input value={sport} onChange={(e) => setSport(e.target.value)} placeholder="Optional" />
                </div>
                <div>
                  <Label>Season</Label>
                  <Input value={season} onChange={(e) => setSeason(e.target.value)} placeholder="2026" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleLink} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Link"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : comps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No PlayHQ competitions linked yet.</p>
      ) : (
        <div className="space-y-2">
          {comps.map((c: any) => (
            <Link key={c.id} to={`/competitions/${c.id}`} className="block">
              <Card className="hover:border-primary transition-colors">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {[c.sport, c.season, c.external_tenant && `tenant: ${c.external_tenant}`].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
