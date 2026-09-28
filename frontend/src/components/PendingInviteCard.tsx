import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, UserCheck, Send, Trash2, Pencil, Mail, Loader2, Copy, Share2, ArrowRightLeft, MoreVertical } from "lucide-react";
import { CardContent } from "@/components/ui/card";
import { SwipeableCard } from "@/components/ui/swipeable-card";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { membershipKeys } from "@/lab/membershipQueryKeys";

interface PendingInviteCardProps {
  invite: {
    id: string;
    role: string;
    invited_user_id: string | null;
    invited_label: string | null;
    invited_email?: string | null;
    metadata?: unknown;
    created_at: string;
    status: string;
    email_sent_at?: string | null;
    email_id?: string | null;
    email_error?: string | null;
    last_reminder_sent_at?: string | null;
    reminder_count?: number | null;
    profiles?: {
      id: string;
      display_name: string | null;
      avatar_url: string | null;
    } | null;
  };
  teamId?: string;
  clubId?: string;
  isAdmin?: boolean;
}

type AppRole = "player" | "parent" | "coach" | "team_admin" | "club_admin";

const roleLabels: Record<string, string> = {
  player: "Player",
  parent: "Parent",
  coach: "Coach",
  team_admin: "Team Admin",
  club_admin: "Club Admin",
};

const roleColors: Record<string, string> = {
  player: "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30",
  parent: "bg-pink-500/20 text-pink-600 dark:text-pink-400 border-pink-500/30",
  coach: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  team_admin: "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30",
  club_admin: "bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30",
};

const editableRoles: AppRole[] = ["player", "parent", "coach", "team_admin"];

export default function PendingInviteCard({ invite, teamId, clubId, isAdmin = true }: PendingInviteCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showReminderSheet, setShowReminderSheet] = useState(false);
  const [showMoveSheet, setShowMoveSheet] = useState(false);
  const [selectedMoveTeamId, setSelectedMoveTeamId] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [editName, setEditName] = useState(invite.invited_label || "");
  const [editRole, setEditRole] = useState<AppRole>(invite.role as AppRole);
  const [isResending, setIsResending] = useState(false);
  

  // Fetch team name and club branding for resend email
  const { data: teamData } = useQuery({
    queryKey: ["team-name", teamId],
    queryFn: async () => {
      if (!teamId) return null;
      const { data } = await supabase
        .from("teams")
        .select("name, club_id, clubs!club_id(name, logo_url, contact_email)")
        .eq("id", teamId)
        .single();
      return data;
    },
    enabled: !!teamId,
    staleTime: 1000 * 60 * 5,
  });

  // Fetch club branding for club invites
  const { data: clubData } = useQuery({
    queryKey: ["club-branding-invite", clubId],
    queryFn: async () => {
      if (!clubId) return null;
      const { data } = await supabase
        .from("clubs")
        .select("name, logo_url, contact_email")
        .eq("id", clubId)
        .single();
      return data;
    },
    enabled: !!clubId && !teamId,
    staleTime: 1000 * 60 * 5,
  });

  // Get the pending invite token and metadata for resending
  const { data: pendingInviteData } = useQuery({
    queryKey: membershipKeys.pendingInviteToken(invite.id),
    queryFn: async () => {
      const { data } = await supabase
        .from("pending_invites")
        .select("invite_token, metadata, short_code")
        .eq("id", invite.id)
        .single();
      return data;
    },
    enabled: !!invite.id,
    staleTime: 1000 * 60 * 5,
  });

  const pendingInviteToken = pendingInviteData?.invite_token;
  const pendingShortCode = (pendingInviteData as any)?.short_code as string | null;
  const inviteMetadata = pendingInviteData?.metadata as { children?: { name: string }[]; customMessage?: string } | null;

  // Use short URL for sharing, full URL for emails/internal
  const inviteLink = pendingInviteToken ? `https://reference.invalid` : null;
  const shareLink = pendingShortCode 
    ? `https://reference.invalid` 
    : inviteLink;

  // Fetch teams in the club for "Move to Team" (only when teamId is set)
  const { data: clubTeams = [] } = useQuery({
    queryKey: ["club-teams-for-pending-move", clubId, teamId],
    queryFn: async () => {
      if (!clubId) return [];
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, is_archived")
        .eq("club_id", clubId!)
        .order("name");
      if (error) throw error;
      return (data || []).filter((t) => !t.is_archived && t.id !== teamId);
    },
    enabled: showMoveSheet && !!clubId && !!teamId,
  });

  const movePendingInviteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMoveTeamId) throw new Error("No team selected");
      const { error } = await supabase
        .from("pending_invites")
        .update({ team_id: selectedMoveTeamId })
        .eq("id", invite.id);
      if (error) throw error;
    },
    onSuccess: () => {
      const targetTeam = clubTeams.find((t) => t.id === selectedMoveTeamId);
      toast({
        title: "Invite moved",
        description: `${invite.invited_label || "Invite"} moved to ${targetTeam?.name || "new team"}`,
      });
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      setShowMoveSheet(false);
      setSelectedMoveTeamId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to move invite",
        description: error.message || "Something went wrong",
        variant: "destructive",
      });
    },
  });

  const buildShareMessage = () => {
    const clubName = teamData?.clubs?.name || clubData?.name || "";
    const teamName = teamData?.name || "";
    const childrenNames = inviteMetadata?.children?.map(c => c.name?.trim()).filter(Boolean) || [];
    const isAdminRole = ['club_admin', 'committee_member', 'coach', 'team_admin'].includes(invite.role);
    const roleName = roleLabels[invite.role] || invite.role.replace("_", " ");
    const email = invite.invited_email;
    const appDownload = `\n\n📲 Download "Ignite Club HQ" from the App Store or Google Play to get started.`;
    const emailNote = email
      ? `\n\nSign up with ${email} so your account links automatically.`
      : "";
    const link = shareLink;

    if (isAdminRole && teamName) {
      return `You've been invited to join ${teamName}${clubName ? ` at ${clubName}` : ""} as ${roleName}. Tap here to get started: ${link}${appDownload}${emailNote}`;
    }
    if (isAdminRole && clubName) {
      return `You've been invited to help run ${clubName} as ${roleName}. Tap here to get started: ${link}${appDownload}${emailNote}`;
    }
    if (invite.role === "parent" && childrenNames.length === 1) {
      return `${childrenNames[0]} has been added to ${teamName || clubName || "the team"}${clubName && teamName ? ` at ${clubName}` : ""}!${appDownload}${emailNote}${link ? `\n\nJoin here: ${link}` : ""}`;
    }
    if (invite.role === "parent" && childrenNames.length > 1) {
      return `Your kids (${childrenNames.join(", ")}) have been added to ${teamName || clubName || "the team"}${clubName && teamName ? ` at ${clubName}` : ""}!${appDownload}${emailNote}${link ? `\n\nJoin here: ${link}` : ""}`;
    }
    if (invite.role === "parent" && teamName) {
      return `Your child has been added to ${teamName}${clubName ? ` at ${clubName}` : ""}!${appDownload}${emailNote}${link ? `\n\nJoin here: ${link}` : ""}`;
    }
    if (teamName) {
      return `You've been added to ${teamName}${clubName ? ` at ${clubName}` : ""}! Tap here to join: ${link}${appDownload}${emailNote}`;
    }
    if (clubName) {
      return `You've been invited to join ${clubName}! Tap here to get started: ${link}${appDownload}${emailNote}`;
    }
    return `You've been invited to join the team! Tap here to get started: ${link}${appDownload}${emailNote}`;
  };

  const handleShareInvite = async () => {
    if (!inviteLink) {
      toast({ title: "No invite link available", variant: "destructive" });
      return;
    }
    const clubName = teamData?.clubs?.name || clubData?.name || "the club";
    const message = buildShareMessage().trim();

    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({
          title: `Join ${clubName}`,
          text: message,
          dialogTitle: `Join ${clubName}`,
        });
        setShowReminderSheet(false);
        return;
      } catch {
        // User cancelled or share failed, fall through to WhatsApp
      }
    }

    const whatsappUrl = `https://reference.invalid)}`;
    window.open(whatsappUrl, "_blank");
    setShowReminderSheet(false);
  };

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("pending_invites")
        .delete()
        .eq("id", invite.id);
      if (error) throw error;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["pending-invites"] });
      const queryCache = queryClient.getQueryCache();
      const pendingInviteQueries = queryCache.findAll({ queryKey: ["pending-invites"] });
      const previousData: { queryKey: any; data: any }[] = [];
      pendingInviteQueries.forEach((query) => {
        const data = query.state.data;
        previousData.push({ queryKey: query.queryKey, data });
        if (Array.isArray(data)) {
          queryClient.setQueryData(query.queryKey, data.filter((inv: any) => inv.id !== invite.id));
        }
      });
      return { previousData };
    },
    onSuccess: () => {
      toast({ title: "Pending invite revoked" });
      setShowDeleteDialog(false);
    },
    onError: (error, _, context) => {
      if (context?.previousData) {
        context.previousData.forEach(({ queryKey, data }) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast({ title: "Failed to revoke invite", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("pending_invites")
        .update({
          invited_label: editName.trim() || null,
          role: editRole as any,
        })
        .eq("id", invite.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      toast({ title: "Pending invite updated" });
      setShowEditDialog(false);
    },
    onError: () => {
      toast({ title: "Failed to update invite", variant: "destructive" });
    },
  });

  // Handle resend email
  const handleResendEmail = async (overrideEmail?: string) => {
    let targetEmail = overrideEmail || invite.invited_email;
    
    if (!targetEmail) {
      const { data: freshInvite } = await supabase
        .from("pending_invites")
        .select("invited_email")
        .eq("id", invite.id)
        .maybeSingle();
      if (freshInvite?.invited_email) {
        targetEmail = freshInvite.invited_email;
      }
    }
    
    if (!targetEmail) {
      setEmailInput("");
      setShowReminderSheet(false);
      setShowEmailDialog(true);
      return;
    }

    if (!pendingInviteToken) {
      toast({ 
        title: "No invite token", 
        description: "Could not find invite token for resending",
        variant: "destructive" 
      });
      return;
    }

    setIsResending(true);
    
    try {
      if (overrideEmail && !invite.invited_email) {
        await supabase
          .from("pending_invites")
          .update({ invited_email: overrideEmail.trim().toLowerCase() } as any)
          .eq("id", invite.id);
      }

      const inviteLinkForEmail = `${window.location.origin}/join/p/${pendingInviteToken}`;
      const recipientName = invite.invited_label || invite.profiles?.display_name || "Member";
      const teamName = teamData?.name || clubData?.name || "the team";
      const clubName = teamData?.clubs?.name || clubData?.name || "The Club";
      const clubLogoUrl = teamData?.clubs?.logo_url || clubData?.logo_url || undefined;
      const clubContactEmail = (teamData?.clubs as any)?.contact_email || (clubData as any)?.contact_email || undefined;
      const childrenNames = invite.role === "parent" && inviteMetadata?.children
        ? inviteMetadata.children.map(c => c.name)
        : undefined;

      const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
        body: {
          to: targetEmail.trim().toLowerCase(),
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
            invitedEmail: targetEmail.trim().toLowerCase(),
            teamName,
            clubName,
            roleName: roleLabels[invite.role] || invite.role.replace("_", " "),
            inviteLink: inviteLinkForEmail,
            clubLogoUrl,
            childrenNames,
            customMessage: inviteMetadata?.customMessage,
          },
        },
      });

      if (funcError) throw new Error(funcError.message || "Failed to send email");

      if (emailResult?.verified && emailResult?.success) {
        await supabase
          .from("pending_invites")
          .update({
            email_sent_at: new Date().toISOString(),
            email_id: emailResult.emailId,
            email_error: null,
          } as any)
          .eq("id", invite.id);

        queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
        toast({ title: "Email sent!", description: `Invite email sent to ${targetEmail}` });
        setShowEmailDialog(false);
        setShowReminderSheet(false);
      } else {
        throw new Error(emailResult?.error || "Email not verified");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await supabase
        .from("pending_invites")
        .update({ email_error: errorMessage } as any)
        .eq("id", invite.id);
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      toast({ title: "Failed to send email", description: errorMessage, variant: "destructive" });
    } finally {
      setIsResending(false);
    }
  };

  const handleOpenEdit = () => {
    setEditName(invite.invited_label || "");
    setEditRole(invite.role as AppRole);
    setShowEditDialog(true);
  };

  const displayName = invite.invited_label || invite.profiles?.display_name || "Unknown";
  const avatarUrl = invite.invited_label ? undefined : invite.profiles?.avatar_url;
  const isExistingUser = !invite.invited_label && !!invite.profiles?.id;
  // Second parents who already have an account get access immediately; the invite
  // row exists so admins can resend/remind until they acknowledge it.
  const addedAwaitingAck =
    !!(invite.metadata as { second_parent_of_existing_user?: boolean } | null)
      ?.second_parent_of_existing_user;
  const roleColor = roleColors[invite.role] || "bg-muted text-muted-foreground";
  const roleLabel = roleLabels[invite.role] || invite.role.replace("_", " ");
  // If a reminder has been sent (either via cron `last_reminder_sent_at`/`reminder_count`,
  // or via manual resend which bumps `email_sent_at` >30s after creation), surface the
  // most recent reminder time so admins know when they last nudged.
  const createdAtMs = new Date(invite.created_at).getTime();
  const emailSentAtMs = invite.email_sent_at ? new Date(invite.email_sent_at).getTime() : 0;
  const lastReminderMs = invite.last_reminder_sent_at ? new Date(invite.last_reminder_sent_at).getTime() : 0;
  const emailReminded = emailSentAtMs > 0 && emailSentAtMs - createdAtMs > 30_000;
  const cronReminded = (invite.reminder_count ?? 0) > 0 && lastReminderMs > 0;
  const wasReminded = emailReminded || cronReminded;
  const reminderMs = Math.max(emailReminded ? emailSentAtMs : 0, cronReminded ? lastReminderMs : 0);
  const timeAgo = formatDistanceToNow(
    new Date(wasReminded ? reminderMs : invite.created_at),
    { addSuffix: true },
  );
  // Distinguish manual resend ("Reminded") from cron auto-reminder ("Auto-reminded")
  // so admins don't think they personally nudged when it was the system.
  const sentLabel = emailReminded
    ? "Reminded"
    : cronReminded
      ? "Auto-reminded"
      : "Sent";

  // Determine if email was the original invite method
  const hasEmail = !!invite.invited_email;

  const swipeActions = isAdmin ? [
    {
      label: "Edit",
      icon: <Pencil className="h-4 w-4" />,
      onClick: handleOpenEdit,
      className: "bg-blue-500 text-white",
    },
    ...(teamId && clubId ? [{
      label: "Move",
      icon: <ArrowRightLeft className="h-4 w-4" />,
      onClick: () => setShowMoveSheet(true),
      className: "bg-amber-500 text-white",
    }] : []),
    {
      label: "Revoke",
      icon: <Trash2 className="h-4 w-4" />,
      onClick: () => setShowDeleteDialog(true),
      className: "bg-destructive text-destructive-foreground",
    },
  ] : [];

  return (
    <>
      <SwipeableCard
        actions={swipeActions}
        enabled={isAdmin}
        className="border-2 border-dashed border-orange-500/40 bg-gradient-to-r from-orange-500/5 to-amber-500/5"
      >
        <CardContent className="p-3 flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-10 w-10 ring-2 ring-orange-500/30 ring-offset-2 ring-offset-background">
              <AvatarImage src={avatarUrl || undefined} />
              <AvatarFallback className="bg-orange-500/20 text-orange-600 dark:text-orange-400">
                {displayName[0]?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-1 -right-1 p-1 rounded-full bg-orange-500 shadow-lg">
              <Clock className="h-2.5 w-2.5 text-white" />
            </div>
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{displayName}</span>
              {addedAwaitingAck && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                  Added — awaiting acknowledgement
                </Badge>
              )}
              {isExistingUser && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30">
                  <UserCheck className="h-2.5 w-2.5 mr-0.5" />
                  Existing
                </Badge>
              )}
            </div>
            {isAdmin && invite.invited_email && (
            <button
                type="button"
                className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground active:text-foreground transition-colors mt-0.5 max-w-full min-w-0 w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(invite.invited_email!);
                  toast({ title: "Email copied", description: invite.invited_email });
                }}
                aria-label={`Copy email ${invite.invited_email}`}
              >
                <span className="truncate min-w-0 flex-1 text-left">{invite.invited_email}</span>
                <Copy className="h-3 w-3 shrink-0 text-primary" />
              </button>
            )}
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              <Badge variant="outline" className={`${roleColor} text-xs`}>
                {roleLabel}
              </Badge>
              <Badge className="bg-orange-500/90 hover:bg-orange-500 text-white text-xs font-medium px-2">
                Pending
              </Badge>
              <span className="text-xs text-muted-foreground">
                {sentLabel} {timeAgo}
              </span>
            </div>
          </div>

          {/* Send Reminder CTA + overflow menu */}
          {isAdmin && (
            <div className="shrink-0 flex items-center gap-1">
              <Button
                size="sm"
                variant="default"
                className="h-8 text-xs font-semibold gap-1.5 px-3"
                onClick={() => setShowReminderSheet(true)}
              >
                <Send className="h-3.5 w-3.5" />
                <span className="hidden xs:inline">Remind</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    aria-label="More actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={handleOpenEdit}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  {invite.invited_email && (
                    <DropdownMenuItem
                      onClick={() => {
                        navigator.clipboard.writeText(invite.invited_email!);
                        toast({ title: "Email copied", description: invite.invited_email });
                      }}
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Copy email
                    </DropdownMenuItem>
                  )}
                  {teamId && clubId && (
                    <DropdownMenuItem onClick={() => setShowMoveSheet(true)}>
                      <ArrowRightLeft className="h-4 w-4 mr-2" />
                      Move to team
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => setShowDeleteDialog(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Revoke invite
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </CardContent>
      </SwipeableCard>



      {/* Send Reminder Bottom Sheet */}
      <Sheet open={showReminderSheet} onOpenChange={setShowReminderSheet}>
        <SheetContent side="bottom" className="max-h-[50vh] rounded-t-2xl" data-allow-scroll>
          <SheetHeader className="text-left pb-4">
            <SheetTitle>Send Reminder</SheetTitle>
            <SheetDescription>
              Choose how to remind <span className="font-medium text-foreground">{displayName}</span> to join
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-2 pb-6">
            {/* Send via Email option */}
            <button
              type="button"
              className="w-full flex items-center gap-3 p-4 rounded-xl border bg-card hover:bg-accent/50 transition-colors text-left"
              onClick={() => handleResendEmail()}
              disabled={isResending}
            >
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                {isResending ? (
                  <Loader2 className="h-5 w-5 text-primary animate-spin" />
                ) : (
                  <Mail className="h-5 w-5 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">Send via Email</span>
                  {hasEmail && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-primary/10 text-primary border-primary/30">
                      Recommended
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {invite.invited_email 
                    ? `Send to ${invite.invited_email}` 
                    : "Enter email address to send invite"
                  }
                </p>
              </div>
            </button>

            {/* Share invite link option */}
            {inviteLink && (
              <button
                type="button"
                className="w-full flex items-center gap-3 p-4 rounded-xl border bg-card hover:bg-accent/50 transition-colors text-left"
                onClick={handleShareInvite}
              >
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Share2 className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">Share invite link</span>
                    {!hasEmail && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-primary/10 text-primary border-primary/30">
                        Recommended
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Share via WhatsApp, SMS, or other apps
                  </p>
                </div>
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Pending Invite</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Enter name"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <div className="grid grid-cols-2 gap-2">
                {editableRoles.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setEditRole(role)}
                    className={`p-2 rounded-lg text-left transition-all border-2 ${
                      editRole === role
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <Badge variant="outline" className={`${roleColors[role]} text-xs`}>
                      {roleLabels[role]}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Pending Invite?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the pending invite for <strong>{displayName}</strong> ({roleLabel}). 
              They can still join using the invite link if it hasn't expired.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Revoking..." : "Revoke Invite"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Email input dialog for invites without email */}
      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Invite Email</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Enter an email address for <strong>{displayName}</strong> to send the invite email.
            </p>
            <div className="space-y-2">
              <Label htmlFor="invite-email-input">Email</Label>
              <Input
                id="invite-email-input"
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="Enter email address"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmailDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => handleResendEmail(emailInput.trim())}
              disabled={!emailInput.trim() || !emailInput.includes("@") || isResending}
            >
              {isResending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Email
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to Team Sheet */}
      <Sheet open={showMoveSheet} onOpenChange={setShowMoveSheet}>
        <SheetContent side="bottom" className="max-h-[80vh] rounded-t-2xl">
          <SheetHeader className="text-left pb-4">
            <SheetTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              Move Pending Invite
            </SheetTitle>
            <SheetDescription>
              Move <span className="font-medium text-foreground">{invite.invited_label || "this invite"}</span> to another team
            </SheetDescription>
          </SheetHeader>

          {clubTeams.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No other teams available</p>
          ) : (
            <RadioGroup
              value={selectedMoveTeamId || ""}
              onValueChange={setSelectedMoveTeamId}
              className="space-y-2 max-h-[40vh] overflow-y-auto pr-1"
            >
              {clubTeams.map((team) => (
                <Label
                  key={team.id}
                  htmlFor={`move-pending-${team.id}`}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    selectedMoveTeamId === team.id
                      ? "bg-primary/10 border-primary"
                      : "bg-muted/30 border-border hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value={team.id} id={`move-pending-${team.id}`} />
                  <span className="text-sm font-medium">{team.name}</span>
                </Label>
              ))}
            </RadioGroup>
          )}

          <div className="pt-4">
            <Button
              className="w-full h-12 text-base font-semibold"
              disabled={!selectedMoveTeamId || movePendingInviteMutation.isPending}
              onClick={() => movePendingInviteMutation.mutate()}
            >
              {movePendingInviteMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <ArrowRightLeft className="h-5 w-5 mr-2" />
              )}
              Move to Team
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
