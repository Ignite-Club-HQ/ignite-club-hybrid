import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Search, UserMinus, X } from "lucide-react";
import { isPlausibleInvitableEmail } from "@/lib/inviteEmailDedupe";
import { CompetitionRoleLinkPanel } from "./CompetitionRoleLinkPanel";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function buildOfficialInviteHtml(p: { name: string; role: "referee" | "committee"; competitionName: string }) {
  const roleText = p.role === "referee" ? "a referee" : "a committee member";
  const comp = escapeHtml(p.competitionName);
  const hello = p.name ? `Hi ${escapeHtml(p.name)},` : "Hi,";
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
<p>${hello}</p>
<p>You've been invited to join <strong>${comp}</strong> as ${roleText} on Ignite Club HQ.</p>
<p>Download Ignite and sign up <strong>using this email address</strong>. You'll be given the role and added to the ${p.role === "referee" ? "referees" : "committee"} chat automatically.</p>
<p><a href="https://apps.apple.com/au/app/ignite-club-hq/id6758928691" style="color:#10b981">Download for iPhone</a> &nbsp;·&nbsp;
<a href="https://play.google.com/store/apps/details?id=app.lovable.igniteteamhub" style="color:#10b981">Download for Android</a> &nbsp;·&nbsp;
<a href="https://igniteclubhq.app/auth?mode=signup" style="color:#10b981">Sign up on the web</a></p>
<p>— ${comp}</p></div>`;
}
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";

type OfficialRole = "referee" | "committee";

const ROLE_LABEL: Record<OfficialRole, string> = {
  referee: "Referee",
  committee: "Committee member",
};

interface Props {
  competitionId: string;
  competitionName: string;
  organizerClubId: string | null;
}

interface RoleRow {
  id: string;
  user_id: string;
  role: string;
  profile: { display_name: string | null; avatar_url: string | null } | null;
}

/**
 * Referee and committee assignment for a single competition.
 *
 * Rows live in `competition_roles`; RLS restricts writes to competition
 * owners/admins, so this component is UI gating only. Assigning someone also
 * creates/updates the matching automatic chat thread server-side (see
 * `ensure_competition_role_chat`).
 */
export function CompetitionOfficialsCard({
  competitionId,
  competitionName,
  organizerClubId,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [pendingRole, setPendingRole] = useState<OfficialRole>("referee");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const rolesQueryKey = ["competition-roles", competitionId];

  const { data: roles = [], isLoading } = useQuery({
    queryKey: rolesQueryKey,
    enabled: !!competitionId,
    queryFn: async () => {
      const { data: roleRows, error } = await supabase
        .from("competition_roles")
        .select("id, user_id, role")
        .eq("competition_id", competitionId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = roleRows ?? [];
      if (rows.length === 0) return [] as RoleRow[];

      const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds);
      const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

      return rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        role: r.role,
        profile: profileMap.get(r.user_id) ?? null,
      })) as RoleRow[];
    },
  });

  const officials = useMemo(
    () => roles.filter((r) => r.role === "referee" || r.role === "committee"),
    [roles],
  );

  // Someone already holding the role we're about to assign shouldn't appear.
  const existingForRole = useMemo(
    () => new Set(roles.filter((r) => r.role === pendingRole).map((r) => r.user_id)),
    [roles, pendingRole],
  );

  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["competition-official-search", competitionId, debouncedSearch],
    enabled: debouncedSearch.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_invitable_profiles", {
        _query: debouncedSearch.trim(),
        _limit: 8,
        _club_id: organizerClubId ?? null,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const visibleResults = useMemo(
    () => searchResults.filter((p: { id: string }) => !existingForRole.has(p.id)),
    [searchResults, existingForRole],
  );

  const addMutation = useMutation({
    mutationFn: async (target: { id: string; display_name: string | null }) => {
      const role = pendingRole;
      const { error } = await supabase.from("competition_roles").insert({
        competition_id: competitionId,
        user_id: target.id,
        role,
      });
      if (error) throw error;

      // Stamp the organising club so the notification stays inside that club's
      // bell when the recipient has more than one club. Failure here must not
      // undo the role assignment, so the result is intentionally not thrown.
      await supabase.from("notifications").insert({
        user_id: target.id,
        type: "membership",
        message: `You have been added as a ${ROLE_LABEL[role].toLowerCase()} for ${competitionName}`,
        related_id: competitionId,
        club_id: organizerClubId ?? null,
      } as any);
      return { target, role };
    },
    onSuccess: ({ target, role }) => {
      queryClient.invalidateQueries({ queryKey: rolesQueryKey });
      queryClient.invalidateQueries({ queryKey: ["chat-groups"] });
      setSearch("");
      toast({
        title: `${ROLE_LABEL[role]} added`,
        description: `${target.display_name ?? "They"} now has access to the ${
          role === "referee" ? "referees" : "committee"
        } chat for ${competitionName}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Could not add", description: error.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (row: RoleRow) => {
      const { error } = await supabase.from("competition_roles").delete().eq("id", row.id);
      if (error) throw error;
      return row;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: rolesQueryKey });
      queryClient.invalidateQueries({ queryKey: ["chat-groups"] });
      toast({
        title: "Removed",
        description: `${row.profile?.display_name ?? "They"} no longer has that role in ${competitionName}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Could not remove", description: error.message, variant: "destructive" });
    },
  });

  const invitesKey = ["competition-role-invites", competitionId];
  const { data: pendingInvites = [] } = useQuery({
    queryKey: invitesKey,
    enabled: !!competitionId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("competition_role_invites")
        .select("id, email, invited_name, role")
        .eq("competition_id", competitionId)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; email: string; invited_name: string | null; role: string }[];
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const role = pendingRole;
      const email = inviteEmail.trim().toLowerCase();
      const name = inviteName.trim();
      const { data, error } = await (supabase as any).rpc("invite_competition_official", {
        p_competition_id: competitionId,
        p_email: email,
        p_name: name,
        p_role: role,
      });
      if (error) throw error;
      const status = (data as { status: string })?.status;
      let emailSent = true;
      if (status === "invited") {
        const { error: mailErr } = await supabase.functions.invoke("send-email", {
          body: {
            to: email,
            senderName: competitionName,
            subject: `You've been invited as a ${ROLE_LABEL[role].toLowerCase()} for ${competitionName}`,
            html: buildOfficialInviteHtml({ name, role, competitionName }),
          },
        });
        emailSent = !mailErr;
      }
      return { status, role, email, emailSent };
    },
    onSuccess: ({ status, role, email, emailSent }) => {
      queryClient.invalidateQueries({ queryKey: rolesQueryKey });
      queryClient.invalidateQueries({ queryKey: invitesKey });
      queryClient.invalidateQueries({ queryKey: ["chat-groups"] });
      setInviteEmail("");
      setInviteName("");
      if (status === "added") {
        toast({
          title: `${ROLE_LABEL[role]} added`,
          description: `${email} already uses Ignite, so they've been added straight away.`,
        });
      } else if (!emailSent) {
        toast({
          title: "Invite saved, email not sent",
          description: `They'll still get the role when they sign up with ${email}. Please let them know.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Invite sent", description: `Emailed ${email}.` });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Could not invite", description: error.message, variant: "destructive" });
    },
  });

  const cancelInvite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("competition_role_invites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invitesKey }),
    onError: (error: Error) =>
      toast({ title: "Could not cancel", description: error.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Referees &amp; committee</CardTitle>
        <CardDescription>
          Referees get their own private chat for this competition, and committee members get
          theirs. Each chat appears as soon as the first person is added, and always includes the
          competition organisers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <div className="divide-y border rounded-md">
            {officials.map((r) => {
              const isSelf = r.user_id === user?.id;
              return (
                <div key={r.id} className="flex items-center gap-3 p-3">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={r.profile?.avatar_url ?? undefined} />
                    <AvatarFallback className="bg-primary/20 text-primary text-xs">
                      {r.profile?.display_name?.charAt(0)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {r.profile?.display_name ?? "Unknown user"}
                      {isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {ROLE_LABEL[r.role as OfficialRole] ?? r.role}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${r.profile?.display_name ?? "user"}`}
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(r)}
                  >
                    <UserMinus className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            {officials.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">
                No referees or committee members yet.
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex gap-2">
            {(["referee", "committee"] as OfficialRole[]).map((role) => (
              <Button
                key={role}
                type="button"
                size="sm"
                variant={pendingRole === role ? "default" : "outline"}
                onClick={() => setPendingRole(role)}
              >
                {ROLE_LABEL[role]}
              </Button>
            ))}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search people to add as ${ROLE_LABEL[pendingRole].toLowerCase()}…`}
              className="pl-9 pr-9"
              aria-label={`Search people to add as ${ROLE_LABEL[pendingRole].toLowerCase()}`}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {debouncedSearch.trim().length >= 2 && (
            <div className="border rounded-md divide-y">
              {isSearching ? (
                <div className="flex justify-center py-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : visibleResults.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No matches.</p>
              ) : (
                visibleResults.map((p: { id: string; display_name: string | null; avatar_url: string | null }) => (
                  <div key={p.id} className="flex items-center gap-3 p-3">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={p.avatar_url ?? undefined} />
                      <AvatarFallback className="bg-muted text-xs">
                        {p.display_name?.charAt(0)?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <p className="flex-1 min-w-0 text-sm truncate">
                      {p.display_name ?? "Unknown user"}
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={addMutation.isPending}
                      onClick={() => addMutation.mutate(p)}
                    >
                      Add
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">Share a link or QR code</p>
          <p className="text-xs text-muted-foreground">
            Anyone who opens it (after signing up or in) becomes a {ROLE_LABEL[pendingRole].toLowerCase()} and joins the chat.
          </p>
          <CompetitionRoleLinkPanel
            key={pendingRole}
            competitionId={competitionId}
            competitionName={competitionName}
            role={pendingRole}
          />
        </div>

        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium flex items-center gap-2">
            <Mail className="h-4 w-4" /> Not on Ignite yet? Invite by email
          </p>
          <p className="text-xs text-muted-foreground">
            They'll get an email to download Ignite. When they sign up with this email they become a{" "}
            {ROLE_LABEL[pendingRole].toLowerCase()} and join the chat automatically.
          </p>
          <Input
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            placeholder="Their name"
            aria-label="Invitee name"
          />
          <Input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="Their email"
            aria-label="Invitee email"
          />
          <Button
            size="sm"
            className="w-full"
            disabled={!isPlausibleInvitableEmail(inviteEmail) || inviteMutation.isPending}
            onClick={() => inviteMutation.mutate()}
          >
            {inviteMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              `Invite as ${ROLE_LABEL[pendingRole].toLowerCase()}`
            )}
          </Button>

          {pendingInvites.length > 0 && (
            <div className="border rounded-md divide-y">
              {pendingInvites.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{inv.invited_name || inv.email}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {inv.email} · invited, not signed up yet
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {ROLE_LABEL[inv.role as OfficialRole] ?? inv.role}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Cancel invite for ${inv.email}`}
                    onClick={() => cancelInvite.mutate(inv.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
