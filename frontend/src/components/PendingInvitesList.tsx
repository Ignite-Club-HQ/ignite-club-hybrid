import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/hooks/use-toast";
import PendingInviteCard from "./PendingInviteCard";
import ReconcilePendingInvitesButton from "./ReconcilePendingInvitesButton";

interface PendingInvite {
  id: string;
  role: string;
  invited_user_id: string | null;
  invited_label: string | null;
  invited_email?: string | null;
  metadata?: unknown;
  created_at: string;
  status: string;
  profiles?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface PendingInvitesListProps {
  invites: PendingInvite[];
  teamId?: string;
  clubId?: string;
  isAdmin?: boolean;
}

const roleLabels: Record<string, string> = {
  player: "Player",
  parent: "Parent",
  coach: "Coach",
  team_admin: "Team Admin",
  club_admin: "Club Admin",
};

export default function PendingInvitesList({ invites, teamId, clubId, isAdmin = true }: PendingInvitesListProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isResendingAll, setIsResendingAll] = useState(false);
  const [showResendAllDialog, setShowResendAllDialog] = useState(false);

  if (invites.length === 0) return null;

  const invitesWithEmail = invites.filter(inv => inv.invited_email);

  const handleResendAll = async () => {
    if (invitesWithEmail.length === 0) return;
    setIsResendingAll(true);

    // Fetch all invite tokens and metadata in one query
    const { data: inviteDetails } = await supabase
      .from("pending_invites")
      .select("id, invite_token, metadata, team_id, club_id")
      .in("id", invitesWithEmail.map(i => i.id));

    const detailsMap = new Map((inviteDetails || []).map(d => [d.id, d]));

    // Fetch club/team branding once
    let clubName = "The Club";
    let clubLogoUrl: string | undefined;
    let clubContactEmail: string | undefined;
    let teamName = "";

    if (teamId) {
      const { data: tData } = await supabase
        .from("teams")
        .select("name, club_id, clubs!club_id(name, logo_url, contact_email)")
        .eq("id", teamId)
        .single();
      teamName = tData?.name || "";
      clubName = (tData?.clubs as any)?.name || clubName;
      clubLogoUrl = (tData?.clubs as any)?.logo_url || undefined;
      clubContactEmail = (tData?.clubs as any)?.contact_email || undefined;
    } else if (clubId) {
      const { data: cData } = await supabase
        .from("clubs")
        .select("name, logo_url, contact_email")
        .eq("id", clubId)
        .single();
      clubName = cData?.name || clubName;
      clubLogoUrl = cData?.logo_url || undefined;
      clubContactEmail = cData?.contact_email || undefined;
    }

    let sentCount = 0;
    let failCount = 0;

    for (const invite of invitesWithEmail) {
      const detail = detailsMap.get(invite.id);
      if (!detail?.invite_token) {
        failCount++;
        continue;
      }

      try {
        const inviteLinkForEmail = `${window.location.origin}/join/p/${detail.invite_token}`;
        const recipientName = invite.invited_label || invite.profiles?.display_name || "Member";
        const meta = detail.metadata as { children?: { name: string }[]; customMessage?: string } | null;
        const childrenNames = invite.role === "parent" && meta?.children
          ? meta.children.map(c => c.name)
          : undefined;

        // Resolve team name for invites that may belong to different teams
        let inviteTeamName = teamName;
        if (!teamName && detail.team_id) {
          const { data: t } = await supabase.from("teams").select("name").eq("id", detail.team_id).single();
          inviteTeamName = t?.name || "";
        }

        const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
          body: {
            to: invite.invited_email,
            subject: childrenNames && childrenNames.length === 1
              ? `Reminder: ${clubName} — see which team ${childrenNames[0]} is in ⚽`
              : childrenNames && childrenNames.length > 1
                ? `Reminder: ${clubName} — see which team your kids are in ⚽`
                : `Reminder: ${clubName} — you've been added to the team ⚽`,
            template: "team-invite",
            senderName: clubName !== "The Club" ? clubName : undefined,
            replyTo: clubContactEmail,
            templateData: {
              recipientName,
              invitedEmail: invite.invited_email,
              teamName: inviteTeamName || clubName,
              clubName,
              roleName: roleLabels[invite.role] || invite.role.replace("_", " "),
              inviteLink: inviteLinkForEmail,
              clubLogoUrl,
              childrenNames,
              customMessage: meta?.customMessage,
            },
          },
        });

        if (funcError) throw funcError;

        if (emailResult?.verified && emailResult?.success) {
          await supabase
            .from("pending_invites")
            .update({
              email_sent_at: new Date().toISOString(),
              email_id: emailResult.emailId,
              email_error: null,
            } as any)
            .eq("id", invite.id);
          sentCount++;
        } else {
          throw new Error(emailResult?.error || "Email not verified");
        }
      } catch {
        failCount++;
      }
    }

    queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
    setIsResendingAll(false);
    setShowResendAllDialog(false);

    if (failCount === 0) {
      toast({ title: `Resent ${sentCount} invite email${sentCount !== 1 ? "s" : ""}` });
    } else {
      toast({
        title: `Sent ${sentCount}, failed ${failCount}`,
        description: "Some emails could not be sent",
        variant: failCount === invitesWithEmail.length ? "destructive" : undefined,
      });
    }
  };

  return (
    <div className="space-y-2">
      <div className="px-1 py-1.5 flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">
          {invites.length} pending invite{invites.length !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <ReconcilePendingInvitesButton
              pendingCount={invites.length}
              teamId={teamId}
              clubId={clubId}
            />
          )}
          {isAdmin && invitesWithEmail.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowResendAllDialog(true)}
              disabled={isResendingAll}
              className="h-7 text-xs gap-1.5"
            >
              {isResendingAll ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Mail className="h-3 w-3" />
              )}
              Resend All
            </Button>
          )}
        </div>
      </div>

      {invites.map((invite) => (
        <PendingInviteCard
          key={invite.id}
          invite={invite}
          teamId={teamId}
          clubId={clubId}
          isAdmin={isAdmin}
        />
      ))}

      <AlertDialog open={showResendAllDialog} onOpenChange={setShowResendAllDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resend All Invite Emails?</AlertDialogTitle>
            <AlertDialogDescription>
              This will resend invite emails to {invitesWithEmail.length} pending invite{invitesWithEmail.length !== 1 ? "s" : ""} that have email addresses.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResendingAll}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResendAll} disabled={isResendingAll}>
              {isResendingAll ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                "Resend All"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
