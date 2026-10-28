import { writeOnce } from "@/live/clubScope";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, Loader2, Mail, QrCode, Share2, UserRoundCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  createLiveCompetitionOfficialEmailInvite,
  createLiveCompetitionOfficialLink,
  listLiveCompetitionJoinLinks,
  revokeLiveCompetitionOfficialEmailInvite,
  revokeLiveCompetitionOfficialLink,
} from "@/live/features/competitions";
import { useToast } from "@/hooks/use-toast";
import { createOfficialEmailInviteSecrets } from "@/features/competitions/officialEmailInvite";
import { resolveAuthBackend } from "@/live/authBackendMode";

type OfficialRole = "referee" | "committee_member";
type OfficialLink = { id: string; token: string; role: OfficialRole };
const roles: { id: OfficialRole; label: string }[] = [
  { id: "referee", label: "Referee" },
  { id: "committee_member", label: "Committee" },
];

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]!));

// Production's competition_role_links table stores "committee" (not "committee_member").
const toDbRole = (role: OfficialRole) => (role === "committee_member" ? "committee" : role);
const fromDbRole = (role: string): OfficialRole => (role === "committee" ? "committee_member" : role as OfficialRole);

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function CompetitionOfficialJoinLinksCard({
  competitionId,
  competitionName,
}: {
  competitionId: string;
  competitionName: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<OfficialRole>("referee");
  const [email, setEmail] = useState("");
  const [showQr, setShowQr] = useState(false);
  const queryKey = ["competition-official-join-links", competitionId];

  const { data: links = [], isLoading } = useQuery({
    queryKey,
    enabled: !!competitionId,
    queryFn: () => withFeatureBackend("competitions", {
      supabase: async () => {
        const { data, error } = await (supabase as any)
          .from("competition_role_links")
          .select("id, token, role")
          .eq("competition_id", competitionId);
        if (error) throw error;
        return ((data ?? []) as { id: string; token: string; role: string }[])
          .map((link) => ({ ...link, role: fromDbRole(link.role) }));
      },
      icp: async (ctx) => (await listLiveCompetitionJoinLinks(ctx, competitionId))
        .filter((link) => !link.revoked && link.team_id.length === 0 && roles.some((item) => item.id === link.role))
        .map((link) => ({ id: `${link.competition_id}:${link.role}`, token: link.token, role: link.role as OfficialRole })),
    }, { competitionId }),
  });
  const activeLink = links.find((link) => link.role === role) ?? null;
  const joinUrl = activeLink ? `${window.location.origin}/competitions/officials/join?token=${encodeURIComponent(activeLink.token)}` : "";

  const createLink = useMutation({
    mutationFn: () => {
      const token = newToken();
      return withFeatureBackend("competitions", {
        supabase: async () => {
          const db = supabase as any;
          const { data: auth } = await supabase.auth.getUser();
          if (!auth.user) throw new Error("Please sign in again.");
          const dbRole = toDbRole(role);
          const { error: deleteError } = await db.from("competition_role_links").delete()
            .eq("competition_id", competitionId).eq("role", dbRole);
          if (deleteError) throw deleteError;
          const { data, error } = await db.from("competition_role_links")
            .insert({ competition_id: competitionId, role: dbRole, token, created_by: auth.user.id })
            .select("id, token, role").single();
          if (error) throw error;
          return { ...data, role: fromDbRole(data.role) } as OfficialLink;
        },
        icp: async (ctx) => createLiveCompetitionOfficialLink(ctx, competitionId, role, token),
      }, writeOnce({ competitionId }));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setShowQr(false);
      toast({ title: `${roles.find((item) => item.id === role)?.label} link ready` });
    },
    onError: (error: Error) => toast({ title: "Could not create link", description: error.message, variant: "destructive" }),
  });

  const revokeLink = useMutation({
    mutationFn: () => withFeatureBackend("competitions", {
      supabase: async () => {
        const { error } = await (supabase as any).from("competition_role_links").delete()
          .eq("competition_id", competitionId).eq("role", toDbRole(role));
        if (error) throw error;
      },
      icp: async (ctx) => revokeLiveCompetitionOfficialLink(ctx, competitionId, role),
    }, writeOnce({ competitionId })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setShowQr(false);
      toast({ title: "Official link revoked" });
    },
    onError: (error: Error) => toast({ title: "Could not revoke link", description: error.message, variant: "destructive" }),
  });

  const copyLink = async () => {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      toast({ title: "Official join link copied" });
    } catch {
      toast({ title: "Could not copy link", variant: "destructive" });
    }
  };

  const shareLink = async () => {
    if (!joinUrl) return;
    if (!navigator.share) return copyLink();
    try {
      await navigator.share({ title: `Join ${competitionName}`, url: joinUrl });
    } catch {
      // Share cancellation is not an error.
    }
  };

  const sendEmail = useMutation({
    mutationFn: async () => {
      const recipient = email.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) throw new Error("Enter a valid email address.");
      const roleLabel = roles.find((item) => item.id === role)?.label.toLowerCase() ?? "official";
      const secrets = await createOfficialEmailInviteSecrets(recipient);
      const emailInviteUrl = `${window.location.origin}/competitions/officials/join?email=1&token=${encodeURIComponent(secrets.token)}`;
      let inviteCreated = false;
      try {
        await withFeatureBackend("competitions", {
          supabase: async () => {
            const { error } = await (supabase as any).rpc("create_competition_role_email_invite", {
              _competition_id: competitionId,
              _role: role,
              _token: secrets.token,
              _email: recipient,
              _verification_code_hash: secrets.codeHash,
            });
            if (error) throw error;
          },
          icp: async (ctx) => {
            const { encryptEmailPayload } = await import("@/live/emailPayload");
            const ciphertext = await encryptEmailPayload(ctx, { to: recipient, resource: secrets.token, code: secrets.code, subject: `Join ${competitionName} as a ${roleLabel}`, text: "" });
            await createLiveCompetitionOfficialEmailInvite(
              ctx, competitionId, role, secrets.token, secrets.emailHash, secrets.codeHash,
            );
            const { connectLiveCompetitionDomain } = await import("@/live/domains");
            const { unwrapCandid } = await import("@/live/features/candid");
            const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
            await unwrapCandid(actor.queue_official_invite_email(secrets.token, ciphertext), "Queue official email");
          },
        }, writeOnce({ competitionId }));
        inviteCreated = true;

        // Best-effort: register the pending welcome email on-chain so the
        // delivery service can send it after the official accepts. Never
        // fails the invite itself.
        await withFeatureBackend("competitions", {
          supabase: async () => {},
          icp: async (ctx) => {
            try {
              const { getLiveCompetitionWelcomeEmail, registerLiveCompetitionWelcomeJob } = await import("@/live/features/competitions");
              const settings = await getLiveCompetitionWelcomeEmail(ctx, competitionId);
              if (settings.enabled) await registerLiveCompetitionWelcomeJob(ctx, secrets.token, recipient);
            } catch (welcomeError) {
              console.error("[welcome-email] competition job registration failed", welcomeError);
            }
          },
        }, writeOnce({ competitionId }));

        if (resolveAuthBackend() === "icp") return;
        const { error } = await supabase.functions.invoke("send-email", {
          body: {
            to: recipient,
            subject: `Join ${competitionName} as a ${roleLabel}`,
            html: `<p>You've been invited to join ${escapeHtml(competitionName)} as a ${roleLabel}.</p><p><a href="${emailInviteUrl}">Accept the invitation</a></p><p>Your one-time verification code is <strong>${secrets.code}</strong>. It expires in 48 hours.</p>`,
          },
        });
        if (error) throw error;
      } catch (error) {
        if (inviteCreated) {
          await withFeatureBackend("competitions", {
            supabase: async () => {
              const { error } = await (supabase as any).rpc("revoke_competition_role_email_invite", { _token: secrets.token });
              if (error) throw error;
            },
            icp: async (ctx) => revokeLiveCompetitionOfficialEmailInvite(ctx, secrets.token),
          }, writeOnce({ competitionId })).catch(() => undefined);
        }
        throw error;
      }
    },
    onSuccess: () => {
      setEmail("");
      toast({ title: resolveAuthBackend() === "icp" ? "Official email queued" : "Official invite emailed" });
    },
    onError: (error: Error) => toast({ title: "Could not email invite", description: error.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4" /> Official join links</CardTitle>
        <CardDescription>Share or email a role-specific link to a referee or committee member.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`official-role-${competitionId}`}>Official role</Label>
          <Select value={role} onValueChange={(value) => { setRole(value as OfficialRole); setShowQr(false); }}>
            <SelectTrigger id={`official-role-${competitionId}`}><SelectValue /></SelectTrigger>
            <SelectContent>{roles.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {isLoading ? <div className="flex justify-center"><Loader2 className="h-4 w-4 animate-spin" /></div> : activeLink ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button className="flex-1" variant="outline" onClick={shareLink}><Share2 className="mr-2 h-4 w-4" /> Share</Button>
              <Button className="flex-1" variant="outline" onClick={copyLink}><Copy className="mr-2 h-4 w-4" /> Copy</Button>
              <Button variant="outline" size="icon" aria-label={showQr ? "Hide QR code" : "Show QR code"} onClick={() => setShowQr((value) => !value)}><QrCode className="h-4 w-4" /></Button>
            </div>
            {showQr && <div className="flex justify-center rounded-md border bg-white p-3"><QRCodeSVG value={joinUrl} size={176} /></div>}
            <Button variant="ghost" size="sm" disabled={revokeLink.isPending} onClick={() => revokeLink.mutate()}>
              {revokeLink.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCheck className="h-4 w-4" />}
              <span className="ml-2">Turn off this link</span>
            </Button>
          </div>
        ) : (
          <Button variant="outline" disabled={createLink.isPending} onClick={() => createLink.mutate()}>
            {createLink.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
            Create {roles.find((item) => item.id === role)?.label.toLowerCase()} link
          </Button>
        )}
        <div className="space-y-2 border-t pt-4">
          <Label htmlFor={`official-email-${competitionId}`}>Email a verified invitation</Label>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input
              id={`official-email-${competitionId}`}
              aria-label="Invitee email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email address"
            />
            <Button variant="outline" disabled={!email.trim() || sendEmail.isPending} onClick={() => sendEmail.mutate()}>
              {sendEmail.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              <span className="ml-2">Email</span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}