import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserPlus, Plus, X, Copy, Mail, Loader2, Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { lookupInvitableUserByEmail } from "@/lib/inviteEmailDedupe";

type InviteRole = "player" | "parent" | "coach" | "team_admin";

const ROLE_LABEL: Record<InviteRole, string> = {
  player: "Player",
  parent: "Parent",
  coach: "Coach",
  team_admin: "Team Admin",
};

interface DraftInvite {
  tempId: string;
  name: string;
  email: string;
  role: InviteRole;
  teamId: string | null;
  status: "pending" | "sending" | "sent" | "error";
  link?: string;
  errorMsg?: string;
}

interface Props {
  clubId: string;
  targetSeasonId: string | null;
  seasonName: string;
}

const NO_TEAM = "__no_team__";

const newRow = (): DraftInvite => ({
  tempId: crypto.randomUUID(),
  name: "",
  email: "",
  role: "player",
  teamId: null,
  status: "pending",
});

export function SeasonInviteStep({ clubId, targetSeasonId, seasonName }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<DraftInvite[]>([newRow()]);

  const { data: club } = useQuery({
    queryKey: ["season-invite-club", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("name, logo_url, contact_email")
        .eq("id", clubId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["season-target-teams", targetSeasonId],
    enabled: !!targetSeasonId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name")
        .eq("season_id", targetSeasonId!)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const sentCount = useMemo(() => rows.filter((r) => r.status === "sent").length, [rows]);

  const patch = (tempId: string, next: Partial<DraftInvite>) =>
    setRows((prev) => prev.map((r) => (r.tempId === tempId ? { ...r, ...next } : r)));

  const send = async (row: DraftInvite) => {
    if (!row.name.trim() && !row.email.trim()) {
      toast.error("Add a name or email first");
      return;
    }
    const isTeamRole = !!row.teamId;
    patch(row.tempId, { status: "sending", errorMsg: undefined });

    try {
      if (row.email.trim()) {
        const match = await lookupInvitableUserByEmail({
          email: row.email.trim(),
          clubId,
          teamId: row.teamId,
        });
        if (match && (match.already_in_club || (isTeamRole && match.already_in_team))) {
          patch(row.tempId, {
            status: "error",
            errorMsg: `${match.display_name ?? "This person"} is already a member — no invite sent.`,
          });
          return;
        }
      }

      const inviteToken = crypto.randomUUID();
      const { error: insErr } = await supabase.from("pending_invites").insert({
        club_id: clubId,
        team_id: row.teamId,
        role: row.role as never,
        invited_user_id: null,
        invited_by_user_id: user?.id ?? null,
        invited_label: row.name.trim() || row.email.trim(),
        invited_email: row.email.trim().toLowerCase() || null,
        invite_token: inviteToken,
      } as never);
      if (insErr) throw insErr;

      const link = `${window.location.origin}/join/p/${inviteToken}`;

      if (row.email.trim()) {
        try {
          const { data: res, error: fnErr } = await supabase.functions.invoke("send-email", {
            body: {
              to: row.email.trim(),
              subject: `You're invited to ${club?.name ?? "our club"} for ${seasonName}`,
              template: "team-invite",
              senderName: club?.name || undefined,
              replyTo: club?.contact_email || undefined,
              templateData: {
                recipientName: row.name.trim(),
                invitedEmail: row.email.trim(),
                teamName: teams.find((t) => t.id === row.teamId)?.name ?? club?.name,
                clubName: club?.name,
                roleName: ROLE_LABEL[row.role],
                inviteLink: link,
                clubLogoUrl: club?.logo_url || undefined,
              },
            },
          });
          if (fnErr) throw fnErr;
          if (!(res?.verified && res?.success)) throw new Error(res?.error || "Email not verified");
          await supabase
            .from("pending_invites")
            .update({ email_sent_at: new Date().toISOString(), email_id: res.emailId } as never)
            .eq("invite_token", inviteToken);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Email failed";
          await supabase
            .from("pending_invites")
            .update({ email_error: msg } as never)
            .eq("invite_token", inviteToken);
          patch(row.tempId, { status: "sent", link, errorMsg: msg });
          toast.message("Invite created — email failed", {
            description: "Share the link manually instead.",
          });
          return;
        }
      }

      patch(row.tempId, { status: "sent", link });
      toast.success(row.email.trim() ? "Invite sent" : "Invite link ready");
    } catch (e) {
      patch(row.tempId, { status: "error", errorMsg: (e as Error).message });
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <UserPlus className="h-5 w-5 text-muted-foreground mt-0.5" />
        <div className="flex-1">
          <h3 className="font-semibold">Invite new members</h3>
          <p className="text-sm text-muted-foreground">
            Invite families joining {seasonName} for the first time. Returning players you
            carried over don't need an invite. Leave the team blank if grades aren't confirmed —
            they'll join the club and can be placed later.
          </p>
        </div>
      </div>

      <ScrollArea className="h-[280px] rounded-lg border">
        <div className="p-2 space-y-2">
          {rows.map((row) => (
            <div key={row.tempId} className="rounded-lg border p-2 space-y-2">
              <div className="flex gap-2">
                <Input
                  value={row.name}
                  onChange={(e) => patch(row.tempId, { name: e.target.value })}
                  placeholder="Name"
                  className="h-9"
                  disabled={row.status === "sent"}
                />
                <Input
                  value={row.email}
                  onChange={(e) => patch(row.tempId, { email: e.target.value })}
                  placeholder="Email (optional)"
                  type="email"
                  className="h-9"
                  disabled={row.status === "sent"}
                />
                {rows.length > 1 && row.status !== "sent" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => setRows((prev) => prev.filter((r) => r.tempId !== row.tempId))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div className="flex gap-2 items-center">
                <Select
                  value={row.role}
                  onValueChange={(v) => patch(row.tempId, { role: v as InviteRole })}
                  disabled={row.status === "sent"}
                >
                  <SelectTrigger className="h-9 w-[130px] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_LABEL) as InviteRole[]).map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={row.teamId ?? NO_TEAM}
                  onValueChange={(v) => patch(row.tempId, { teamId: v === NO_TEAM ? null : v })}
                  disabled={row.status === "sent"}
                >
                  <SelectTrigger className="h-9 flex-1 text-sm">
                    <SelectValue placeholder="Team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TEAM}>Club only (no team yet)</SelectItem>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {row.status === "sent" ? (
                  <Badge variant="secondary" className="h-9 px-2 gap-1">
                    <Check className="h-3.5 w-3.5" /> Sent
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    className="h-9"
                    onClick={() => send(row)}
                    disabled={row.status === "sending"}
                  >
                    {row.status === "sending" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <><Mail className="h-4 w-4 mr-1" /> Invite</>
                    )}
                  </Button>
                )}
              </div>

              {row.link && (
                <div className="flex items-center gap-2">
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground truncate flex-1">{row.link}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    onClick={() => {
                      navigator.clipboard.writeText(row.link!);
                      toast.success("Link copied");
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              {row.errorMsg && (
                <p className="text-xs text-destructive">{row.errorMsg}</p>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setRows((prev) => [...prev, newRow()])}>
          <Plus className="h-4 w-4 mr-1" /> Add another
        </Button>
        <span className="text-xs text-muted-foreground">
          {sentCount} invite{sentCount === 1 ? "" : "s"} sent
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        You can invite more people any time from the club and team pages — this step is optional.
      </p>
    </div>
  );
}
