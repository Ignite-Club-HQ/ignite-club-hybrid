import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Search, Loader2, Mail, X, CheckCircle2, Users, Share2, Copy } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { MobileCardSelect } from "@/components/MobileCardSelect";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";
import { useNativeKeyboardBottomInset } from "@/hooks/useNativeKeyboardBottomInset";

type ClubRole = "club_admin" | "committee_member";

const roleConfig: Record<ClubRole, { label: string; description: string; colorClass: string }> = {
  club_admin: {
    label: "Club Admin",
    description: "Full club management access",
    colorClass: "bg-purple-500/20 text-purple-600 border-purple-500/30",
  },
  committee_member: {
    label: "Committee Member",
    description: "Club governance participation",
    colorClass: "bg-cyan-500/20 text-cyan-600 border-cyan-500/30",
  },
};

interface AddClubAdminSheetProps {
  clubId: string;
  clubName: string;
}

export default function AddClubAdminSheet({ clubId, clubName }: AddClubAdminSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null>(null);
  const [customName, setCustomName] = useState("");
  const [customEmail, setCustomEmail] = useState("");
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isSendingNotification, setIsSendingNotification] = useState(false);
  const [selectedRole, setSelectedRole] = useState<ClubRole>("club_admin");
  const [deliveryMethod, setDeliveryMethod] = useState<"email" | "share">("share");

  const debouncedSearch = useDebounce(customName, 300);
  const nativeKbHeight = useNativeKeyboardBottomInset();

  // Fetch existing club admins
  const { data: existingMembers } = useQuery({
    queryKey: ["club-roles", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", clubId)
        .is("team_id", null);
      return data?.map(m => m.user_id) || [];
    },
    enabled: !!clubId,
  });

  // Fetch club branding data for emails
  const { data: clubBranding } = useQuery({
    queryKey: ["club-branding", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("name, logo_url, contact_email")
        .eq("id", clubId)
        .single();
      return data;
    },
    enabled: !!clubId,
  });

  // Search for existing users
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["user-search-club-admin", debouncedSearch, clubId],
    queryFn: async () => {
      if (debouncedSearch.length < 2) return [];
      const { data } = await supabase.rpc("search_invitable_profiles", {
        _query: debouncedSearch,
        _limit: 8,
        _club_id: clubId ?? null,
      });
      return (data || []) as Array<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        masked_email: string | null;
      }>;
    },
    enabled: debouncedSearch.length >= 2,
  });

  // Filter out existing members
  const filteredResults = searchResults.filter(
    user => !existingMembers?.includes(user.id)
  );

  // Add existing user directly to club
  const addExistingUserMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) throw new Error("No user selected");

      const { error } = await supabase.from("user_roles").insert({
        user_id: selectedUser.id,
        club_id: clubId,
        role: selectedRole,
      });
      if (error) throw error;

      // Send notification
      await supabase.from("notifications").insert({
        user_id: selectedUser.id,
        type: "membership",
        message: `You have been added to ${clubName} as ${roleConfig[selectedRole].label}`,
        related_id: clubId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-roles", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club-members-roles", clubId] });
      toast({
        title: "Member added",
        description: `${selectedUser?.display_name} has been added as ${roleConfig[selectedRole].label}`,
      });
      handleClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add member",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Add pending member (by name) with invite
  const addPendingMemberMutation = useMutation({
    mutationFn: async () => {
      if (!customName.trim()) throw new Error("Please enter a name");

      // Create a unique token for this specific pending invite
      const inviteToken = crypto.randomUUID();

      // Create pending invite record with the unique token
      const { error: inviteError } = await supabase.from("pending_invites").insert({
        club_id: clubId,
        team_id: null,
        role: selectedRole as any,
        invited_user_id: null, // Will be set when user accepts invite
        invited_by_user_id: user!.id,
        invited_label: customName.trim(),
        invited_email: customEmail.trim().toLowerCase() || null,
        invite_token: inviteToken,
      } as any);
      if (inviteError) throw inviteError;

      // Use the pending invite token for name-restricted link
      const link = `${window.location.origin}/join/p/${inviteToken}`;
      return { link, email: customEmail.trim(), inviteToken };
    },
    onSuccess: async ({ link, email, inviteToken }) => {
      setInviteLink(link);
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });

      // Auto-send email notification if email was provided
      if (email) {
        setIsSendingNotification(true);
        let emailSent = false;
        let emailId: string | null = null;
        let emailError: string | null = null;
        
        try {
          const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
            body: {
              to: email,
              subject: `You're invited to join ${clubName} as ${roleConfig[selectedRole].label}`,
              template: "team-invite",
              senderName: clubName || undefined,
              replyTo: (clubBranding as any)?.contact_email || undefined,
              templateData: {
                recipientName: customName.trim(),
                invitedEmail: email,
                teamName: clubName, // Using teamName field for club name
                clubName: clubName,
                roleName: roleConfig[selectedRole].label,
                inviteLink: link,
                clubLogoUrl: clubBranding?.logo_url || undefined,
              },
            },
          });
          
          if (funcError) {
            emailError = funcError.message || "Function error";
            console.error("Email function error:", funcError);
          } else if (emailResult?.verified && emailResult?.success) {
            emailSent = true;
            emailId = emailResult.emailId;
            toast({
              title: "Invite sent!",
              description: `Email notification sent to ${email}`,
            });
          } else {
            emailError = emailResult?.error || "Email not verified";
            console.warn("Email not verified:", emailResult);
            toast({
              title: "Admin added",
              description: "Could not send email, but invite link is ready to share",
              variant: "default",
            });
          }
        } catch (error) {
          emailError = error instanceof Error ? error.message : "Unknown error";
          console.error("Failed to send email:", error);
          toast({
            title: "Admin added",
            description: "Could not send email, but invite link is ready to share",
            variant: "default",
          });
        } finally {
          setIsSendingNotification(false);
          
          // Update pending invite with email status
          await supabase
            .from("pending_invites")
            .update({
              email_sent_at: emailSent ? new Date().toISOString() : null,
              email_id: emailId,
              email_error: emailError,
            } as any)
            .eq("invite_token", inviteToken);
        }
      } else {
        toast({
          title: "Member added as pending",
          description: `${customName} has been added. Share the invite link with them.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add admin",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    setOpen(false);
    setSelectedUser(null);
    setCustomName("");
    setCustomEmail("");
    setInviteLink(null);
    setInviteSent(false);
    setSelectedRole("club_admin");
    setDeliveryMethod("share");
  };

  const handleDone = () => {
    handleClose();
  };

  return (
    <Sheet open={open} onOpenChange={(isOpen) => isOpen ? setOpen(true) : handleClose()}>
      <SheetTrigger asChild>
        <Button size="sm">
          <UserPlus className="h-4 w-4 mr-2" />
          Invite to Team
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="rounded-t-2xl flex flex-col overflow-hidden overscroll-contain sm:mx-auto sm:max-w-md"
        data-lock-keyboard-scroll="true"
        data-allow-scroll
        style={{
          touchAction: "pan-y",
          WebkitOverflowScrolling: "touch",
          bottom: nativeKbHeight > 0 ? `${nativeKbHeight}px` : undefined,
          maxHeight:
            nativeKbHeight > 0
              ? `calc(100dvh - ${nativeKbHeight}px - env(safe-area-inset-top, 0px) - 8px)`
              : "calc(100dvh - env(safe-area-inset-top, 0px) - 8px)",
          height:
            nativeKbHeight > 0
              ? `calc(100dvh - ${nativeKbHeight}px - env(safe-area-inset-top, 0px) - 8px)`
              : undefined,
          transitionProperty: "bottom, height, max-height",
          transitionDuration: "200ms",
          transitionTimingFunction: "ease",
        }}
      >
        <SheetHeader className="space-y-1 pb-3 border-b shrink-0 relative pr-10">
          <div className="flex items-center gap-3">
            <div className={`p-2 sm:p-2.5 rounded-full shrink-0 ${selectedRole === "club_admin" ? "bg-purple-500/10" : "bg-cyan-500/10"}`}>
              <Users className={`h-5 w-5 ${selectedRole === "club_admin" ? "text-purple-500" : "text-cyan-500"}`} />
            </div>
            <div className="min-w-0 text-left">
              <SheetTitle className="text-base sm:text-lg truncate">Add Club Member</SheetTitle>
              <SheetDescription className="text-xs sm:text-sm truncate">{clubName}</SheetDescription>
            </div>
          </div>
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-8 w-8 rounded-full opacity-70 hover:opacity-100"
              aria-label="Close invite sheet"
            >
              <X className="h-4 w-4" />
            </Button>
          </SheetClose>
        </SheetHeader>

        <div
          data-allow-scroll
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-6 px-6"
          style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}
        >

        {/* Success State - Email sent confirmation */}
        {inviteLink && (
          <div className="space-y-5 pt-6">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 mb-2">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              </div>
              <h3 className="font-semibold text-lg">Member Added!</h3>
              <p className="text-sm text-muted-foreground">
                {customEmail
                  ? <>Invite sent to <span className="font-medium">{customEmail}</span></>
                  : "Invite link created — share it with them"}
              </p>
            </div>

            <div className={`p-4 rounded-xl bg-gradient-to-br ${selectedRole === "club_admin" ? "from-purple-500/5 to-purple-500/10 border-purple-500/20" : "from-cyan-500/5 to-cyan-500/10 border-cyan-500/20"} border`}>
              <p className="font-medium mb-1">{customName}</p>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                Invited as {roleConfig[selectedRole].label}
              </p>
            </div>

            {/* Share options */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-center">Share invite via</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={async () => {
                    const msg = `You've been invited to join ${clubName} as ${roleConfig[selectedRole].label}. Tap here to get started: ${inviteLink}\n\n📲 Download "Ignite Club HQ" from the App Store or Google Play to get started.${customEmail ? `\n\nSign up with ${customEmail} so your account links automatically.` : ""}`.trim();
                    if (Capacitor.isNativePlatform()) {
                      try {
                        await Share.share({
                          title: `Join ${clubName}`,
                          text: msg,
                          dialogTitle: 'Share invite',
                        });
                        return;
                      } catch { /* cancelled */ }
                    }
                    window.open(`https://reference.invalid)}`, "_blank");
                  }}
                >
                  <Share2 className="h-4 w-4 mr-2" />
                  Share
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inviteLink || "");
                      toast({ title: "Invite link copied!" });
                    } catch {
                      toast({ title: "Failed to copy link", variant: "destructive" });
                    }
                  }}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Link
                </Button>
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <Button 
                variant="outline" 
                className="flex-1" 
                onClick={() => {
                  setInviteLink(null);
                  setCustomName("");
                  setCustomEmail("");
                  setDeliveryMethod("share");
                }}
              >
                Add Another
              </Button>
              <Button className="flex-1" onClick={handleDone}>
                Done
              </Button>
            </div>
          </div>
        )}

        {/* Main Form */}
        {!inviteLink && (
          <div className="space-y-5 pt-6">
            {/* Unified Name field with autocomplete */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Name *</Label>
              <div className="relative">
                {selectedUser ? (
                  <div className="flex items-center gap-3 h-11 px-3 rounded-md border border-emerald-500 bg-emerald-500/5">
                    <Avatar className="h-7 w-7 border border-emerald-500/30">
                      <AvatarImage src={selectedUser.avatar_url || undefined} />
                      <AvatarFallback className="bg-emerald-500/20 text-emerald-600 text-xs font-semibold">
                        {selectedUser.display_name?.charAt(0) || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium text-sm flex-1 text-emerald-700 dark:text-emerald-400">{selectedUser.display_name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setSelectedUser(null);
                        setCustomName("");
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name or email..."
                      value={customName}
                      onChange={(e) => {
                        setCustomName(e.target.value);
                        setSelectedUser(null);
                      }}
                      className="pl-10 h-11"
                    />
                    {customName && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                        onClick={() => { setCustomName(""); setSelectedUser(null); }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </>
                )}
              </div>

              {/* Autocomplete dropdown */}
              {!selectedUser && debouncedSearch.length >= 2 && (
                <div className="space-y-1 max-h-44 overflow-y-auto rounded-lg border bg-muted/30 p-1.5">
                  {isSearching ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredResults.length > 0 ? (
                    filteredResults.map((result) => (
                      <div
                        key={result.id}
                        className="flex items-center gap-3 p-2.5 rounded-lg cursor-pointer hover:bg-background border border-transparent hover:border-border transition-all"
                        onClick={() => {
                          setSelectedUser(result);
                          setCustomName(result.display_name || "");
                        }}
                      >
                        <Avatar className="h-8 w-8 border border-border">
                          <AvatarImage src={result.avatar_url || undefined} />
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {result.display_name?.charAt(0) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="font-medium text-sm truncate">{result.display_name || "Unknown"}</span>
                          {(result as any).masked_email && (
                            <span className="text-xs text-muted-foreground truncate">{(result as any).masked_email}</span>
                          )}
                        </div>
                        <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0 shrink-0">Existing</Badge>
                      </div>
                    ))
                  ) : null}
                </div>
              )}
            </div>

            {/* Delivery method - only show for new users (not selected existing) */}
            {!selectedUser && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">How should we deliver the invite?</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDeliveryMethod("email")}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      deliveryMethod === "email"
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <Mail className="h-4 w-4" />
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDeliveryMethod("share"); setCustomEmail(""); }}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      deliveryMethod === "share"
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <Share2 className="h-4 w-4" />
                    Share Link
                  </button>
                </div>
                {deliveryMethod === "email" ? (
                  <div className="space-y-1.5">
                    <Input
                      type="email"
                      placeholder="Enter email to send invite"
                      value={customEmail}
                      onChange={(e) => setCustomEmail(e.target.value)}
                      className="h-11"
                    />
                    <p className="text-xs text-muted-foreground">An invite email will be sent automatically</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">You'll be able to share via WhatsApp, Messenger, SMS, or copy the link after adding</p>
                )}
              </div>
            )}

            <MobileCardSelect
              value={selectedRole}
              onValueChange={(v) => setSelectedRole(v as ClubRole)}
              options={[
                { value: "club_admin", label: "Club Admin" },
                { value: "committee_member", label: "Committee Member" },
              ]}
              label="Role"
              required
            />

            <div className={`p-3 rounded-lg ${selectedRole === "club_admin" ? "bg-purple-500/10 border-purple-500/20" : "bg-cyan-500/10 border-cyan-500/20"} border`}>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={roleConfig[selectedRole].colorClass}>
                  {roleConfig[selectedRole].label}
                </Badge>
                <span className="text-xs text-muted-foreground">{roleConfig[selectedRole].description}</span>
              </div>
            </div>
          </div>
        )}
        </div>

        {!inviteLink && (
          <div className="shrink-0 border-t pt-3 pb-[max(env(safe-area-inset-bottom,0px),0.5rem)] -mx-6 px-6 bg-background">
            <Button
              className="w-full h-12 text-sm sm:text-base"
              onClick={() => {
                if (selectedUser) {
                  addExistingUserMutation.mutate();
                } else {
                  addPendingMemberMutation.mutate();
                }
              }}
              disabled={
                (!customName.trim() && !selectedUser) ||
                (!selectedUser && deliveryMethod === "email" && !customEmail.trim()) ||
                addPendingMemberMutation.isPending ||
                addExistingUserMutation.isPending ||
                isSendingNotification
              }
            >
              {addPendingMemberMutation.isPending || addExistingUserMutation.isPending || isSendingNotification ? (
                <Loader2 className="h-5 w-5 mr-2 animate-spin shrink-0" />
              ) : (
                <UserPlus className="h-5 w-5 mr-2 shrink-0" />
              )}
              <span className="truncate">
                {(customName.trim() || selectedUser)
                  ? `Add ${selectedUser?.display_name || customName.trim()} as ${roleConfig[selectedRole].label}`
                  : "Enter name to continue"}
              </span>
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
