import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search, Trash2, Shield, Mail, Send, Copy, Check, X, Share2 } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";

import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import type { Database, Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import MiniLeagueAdminJoinLinkCard from "./MiniLeagueAdminJoinLinkCard";

interface ManageMiniLeagueAdminsSheetProps {
  miniLeagueId: string;
  miniLeagueName: string;
  clubId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ClubMember {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

type PendingInviteInsert = Database["public"]["Tables"]["pending_invites"]["Insert"];
type PendingInviteUpdate = Database["public"]["Tables"]["pending_invites"]["Update"];

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
};

export function ManageMiniLeagueAdminsSheet({
  miniLeagueId,
  miniLeagueName,
  clubId,
  open,
  onOpenChange,
}: ManageMiniLeagueAdminsSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 200);
  const [tab, setTab] = useState<"existing" | "invite">("existing");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Club name for email branding
  const { data: clubInfo } = useQuery({
    queryKey: ["club-branding-mini-league-invite", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("name, logo_url, contact_email")
        .eq("id", clubId)
        .single();
      return data;
    },
    enabled: open && !!clubId,
  });

  // Current per-league admin grants
  const { data: currentAdmins, isLoading: loadingCurrent } = useQuery({
    queryKey: ["mini-league-admins", miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_admins")
        .select("id, user_id, created_at")
        .eq("mini_league_id", miniLeagueId);
      if (error) throw error;

      const userIds = (data || []).map((r) => r.user_id);
      if (userIds.length === 0) return [];

      const { data: profiles } = await selectCachedProfilesByIds(userIds);

      const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
      return (data || []).map((r) => ({
        id: r.id,
        user_id: r.user_id,
        display_name: profileMap.get(r.user_id)?.display_name ?? null,
        avatar_url: profileMap.get(r.user_id)?.avatar_url ?? null,
      }));
    },
    enabled: open && !!miniLeagueId,
  });

  // Club members eligible to be promoted (anyone with a role in the club)
  const { data: clubMembers } = useQuery({
    queryKey: ["club-members-pickable", clubId],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", clubId);

      const ids = [...new Set((roles || []).map((r) => r.user_id))];
      if (ids.length === 0) return [] as ClubMember[];

      const { data: profiles } = await selectCachedProfilesByIds(ids);

      return (profiles || []).map((p) => ({
        user_id: p.id,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
      })) as ClubMember[];
    },
    enabled: open && !!clubId,
  });

  const grantMutation = useMutation({
    mutationFn: async (targetUserId: string) => {
      const { error } = await supabase.from("mini_league_admins").insert({
        mini_league_id: miniLeagueId,
        user_id: targetUserId,
        granted_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-admins", miniLeagueId] });
      queryClient.invalidateQueries({ queryKey: ["mini-league-members"] });
      toast({ title: "League admin added" });
    },
    onError: (err: unknown) => {
      toast({
        title: "Couldn't add admin",
        description: getErrorMessage(err, "Please try again"),
        variant: "destructive",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (rowId: string) => {
      const { error } = await supabase
        .from("mini_league_admins")
        .delete()
        .eq("id", rowId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-admins", miniLeagueId] });
      queryClient.invalidateQueries({ queryKey: ["mini-league-members"] });
      toast({ title: "League admin removed" });
    },
    onError: (err: unknown) => {
      toast({
        title: "Couldn't remove admin",
        description: getErrorMessage(err, "Please try again"),
        variant: "destructive",
      });
    },
  });


  // Pending email invites for this league (league_admin role + matching mini_league_id in metadata)
  const { data: pendingInvites } = useQuery({
    queryKey: ["mini-league-pending-admin-invites", miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, invited_label, invited_email, invite_token, status, created_at, email_sent_at, metadata")
        .eq("club_id", clubId)
        .eq("role", "league_admin")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).filter(
        (r) =>
          typeof r.metadata === "object" && r.metadata !== null && !Array.isArray(r.metadata) &&
          r.metadata.mini_league_id === miniLeagueId &&
          r.metadata.kind !== "league_admin_join_link",
      );
    },
    enabled: open && !!miniLeagueId,
  });

  const sendInviteMutation = useMutation({
    mutationFn: async () => {
      const email = inviteEmail.trim().toLowerCase();
      const name = inviteName.trim();
      if (!email || !name) throw new Error("Name and email are required");
      const inviteToken = crypto.randomUUID();

      const invitePayload: PendingInviteInsert = {
        club_id: clubId,
        role: "league_admin",
        invited_user_id: null,
        invited_by_user_id: user!.id,
        invited_label: name,
        invited_email: email,
        invite_token: inviteToken,
        metadata: {
          mini_league_id: miniLeagueId,
          kind: "mini_league_admin_invite",
        } satisfies Json,
      };
      const { error: insertErr } = await supabase
        .from("pending_invites")
        .insert(invitePayload);
      if (insertErr) throw insertErr;

      const link = `${window.location.origin}/join/p/${inviteToken}`;
      let emailSent = false;
      let emailError: string | null = null;
      try {
        const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
          body: {
            to: email,
            subject: `You're invited as a League Admin for ${miniLeagueName}`,
            template: "team-invite",
            senderName: clubInfo?.name || undefined,
            replyTo: clubInfo?.contact_email || undefined,
            templateData: {
              recipientName: name,
              invitedEmail: email,
              teamName: miniLeagueName,
              clubName: clubInfo?.name || "The Club",
              roleName: "League Admin",
              inviteLink: link,
              clubLogoUrl: clubInfo?.logo_url || undefined,
            },
          },
        });
        emailSent = !funcError && emailResult?.verified && emailResult?.success;
        if (funcError) emailError = funcError.message;
        else if (!emailSent) emailError = "Email not verified";
      } catch (e: unknown) {
        emailError = getErrorMessage(e, "Failed to send email");
      }

      await supabase
        .from("pending_invites")
        .update({
          email_sent_at: emailSent ? new Date().toISOString() : null,
          email_error: emailError,
        } satisfies PendingInviteUpdate)
        .eq("invite_token", inviteToken);

      return { emailSent, link };
    },
    onSuccess: ({ emailSent }) => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-pending-admin-invites", miniLeagueId] });
      toast({
        title: emailSent ? "Invite sent" : "Invite created",
        description: emailSent
          ? `Email sent to ${inviteEmail.trim()}`
          : "Email couldn't be sent — copy the link below to share manually",
      });
      setInviteName("");
      setInviteEmail("");
    },
    onError: (err: unknown) => {
      toast({
        title: "Couldn't create invite",
        description: getErrorMessage(err, "Please try again"),
        variant: "destructive",
      });
    },
  });

  const cancelPendingMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase
        .from("pending_invites")
        .update({ status: "cancelled" } satisfies PendingInviteUpdate)
        .eq("id", inviteId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-pending-admin-invites", miniLeagueId] });
      toast({ title: "Invite cancelled" });
    },
  });

  const handleCopyLink = async (token: string) => {
    const link = `${window.location.origin}/join/p/${token}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 1500);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Couldn't copy link", variant: "destructive" });
    }
  };

  const handleShareLink = async (token: string, recipientName?: string | null) => {
    const link = `${window.location.origin}/join/p/${token}`;
    const title = `League Admin invite — ${miniLeagueName}`;
    const text = `${recipientName ? `${recipientName}, you're` : "You're"} invited to be a League Admin for ${miniLeagueName}. Tap to accept:`;
    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({ title, text, url: link, dialogTitle: "Share invite link" });
        return;
      } catch {/* cancelled */}
    }
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, text, url: link });
        return;
      } catch {/* cancelled */}
    }
    handleCopyLink(token);
  };

  const currentIds = new Set((currentAdmins || []).map((a) => a.user_id));
  const filteredMembers = (clubMembers || [])
    .filter((m) => !currentIds.has(m.user_id))
    .filter((m) => {
      if (!debouncedSearch.trim()) return true;
      const name = (m.display_name || "").toLowerCase();
      return name.includes(debouncedSearch.toLowerCase());
    })
    .slice(0, 50);


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] max-h-[85vh] rounded-t-2xl flex flex-col overflow-hidden overscroll-contain" data-allow-scroll>
        <SheetHeader className="text-left shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            League Admins
          </SheetTitle>
          <SheetDescription>
            Grant admin rights for {miniLeagueName} to specific club members.
            Club admins and club-wide League Admins keep their access automatically.
          </SheetDescription>
        </SheetHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "existing" | "invite")} className="flex-1 min-h-0 overflow-hidden flex flex-col mt-2">
          <TabsList className="grid grid-cols-2 w-full shrink-0">
            <TabsTrigger value="existing">From club</TabsTrigger>
            <TabsTrigger value="invite">Invite</TabsTrigger>
          </TabsList>

          <TabsContent value="existing" className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 mt-3 pb-8 data-[state=inactive]:hidden" data-allow-scroll style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}>
            {/* Current admins */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                Current
              </p>
              {loadingCurrent ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (currentAdmins || []).length === 0 ? (
                <p className="text-sm text-muted-foreground px-1 py-2">
                  No per-league admins yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {(currentAdmins || []).map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 p-2 rounded-lg bg-card border"
                    >
                      <Avatar className="h-8 w-8">
                        {a.avatar_url && <AvatarImage src={a.avatar_url} />}
                        <AvatarFallback className="bg-primary/20 text-primary text-sm">
                          {(a.display_name || "?").charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <p className="flex-1 text-sm font-medium truncate">
                        {a.display_name || "Unknown"}
                      </p>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => revokeMutation.mutate(a.id)}
                        disabled={revokeMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Picker */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                Add from club
              </p>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search club members…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 h-11 leading-normal"
                />
              </div>
              <div className="-mx-2 px-2">
                <div className="space-y-1.5 pb-4">
                  {filteredMembers.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-1 py-4 text-center">
                      No matches.
                    </p>
                  ) : (
                    filteredMembers.map((m) => (
                      <div
                        key={m.user_id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50"
                      >
                        <Avatar className="h-8 w-8">
                          {m.avatar_url && <AvatarImage src={m.avatar_url} />}
                          <AvatarFallback className="bg-muted text-foreground text-sm">
                            {(m.display_name || "?").charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <p className="flex-1 text-sm truncate">
                          {m.display_name || "Unknown"}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => grantMutation.mutate(m.user_id)}
                          disabled={grantMutation.isPending}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          Add
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="invite" className="flex-1 min-h-0 overflow-hidden flex flex-col mt-3 data-[state=inactive]:hidden">
            <ScrollArea className="flex-1 min-h-0 -mx-2 px-2">
              <div className="space-y-4 pb-6">
                {/* Shareable join link — primary CTA */}
                <MiniLeagueAdminJoinLinkCard
                  miniLeagueId={miniLeagueId}
                  miniLeagueName={miniLeagueName}
                  clubId={clubId}
                />

                {/* Email invite — for a specific person */}
                <div className="space-y-3 rounded-lg border bg-card p-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Invite someone not on the app
              </p>
              <div className="space-y-2">
                <Label htmlFor="ml-invite-name" className="text-xs">Their name</Label>
                <Input
                  id="ml-invite-name"
                  placeholder="Jane Smith"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ml-invite-email" className="text-xs">Email</Label>
                <Input
                  id="ml-invite-email"
                  type="email"
                  inputMode="email"
                  placeholder="redacted@example.invalid"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <Button
                onClick={() => sendInviteMutation.mutate()}
                disabled={sendInviteMutation.isPending || !inviteName.trim() || !inviteEmail.trim()}
                className="w-full gap-2"
              >
                {sendInviteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send invite
              </Button>
              <p className="text-[11px] text-muted-foreground leading-snug">
                They'll receive an email with a link. Once they sign up, they get
                League Admin rights for {miniLeagueName} only.
              </p>
            </div>

                {/* Pending list */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                    Pending email invites
                  </p>
                  <div className="space-y-1.5">
                    {(pendingInvites || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground px-1 py-4 text-center">
                        No pending email invites.
                      </p>
                    ) : (
                      (pendingInvites || []).map((inv) => (
                        <div
                          key={inv.id}
                          className="flex items-center gap-2 p-2 rounded-lg bg-card border"
                        >
                          <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{inv.invited_label}</p>
                            <p className="text-xs text-muted-foreground truncate">{inv.invited_email}</p>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => inv.invite_token && handleCopyLink(inv.invite_token)}
                            title="Copy invite link"
                          >
                            {copiedToken === inv.invite_token ? (
                              <Check className="h-4 w-4 text-primary" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => inv.invite_token && handleShareLink(inv.invite_token, inv.invited_label)}
                            title="Share invite link"
                          >
                            <Share2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => cancelPendingMutation.mutate(inv.id)}
                            disabled={cancelPendingMutation.isPending}
                            title="Cancel invite"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
