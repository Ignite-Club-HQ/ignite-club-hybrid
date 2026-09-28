import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfileById } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, UserPlus, Search, Link2 } from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/useDebounce";
import type { Database, Json } from "@/integrations/supabase/types";

interface AddSecondParentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playerId: string;
  playerName: string;
  childId: string | null;
  miniLeagueId: string;
  miniLeagueName: string;
  clubId: string;
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ExistingUser = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email?: string | null;
};

export function AddSecondParentDialog({
  open,
  onOpenChange,
  playerId,
  playerName,
  childId,
  miniLeagueId,
  miniLeagueName,
  clubId,
}: AddSecondParentDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUser, setSelectedUser] = useState<ExistingUser | null>(null);
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");

  const debouncedSearch = useDebounce(searchTerm, 300);
  const isEmailSearch = debouncedSearch.includes("@");

  const reset = () => {
    setSearchTerm("");
    setSelectedUser(null);
    setParentName("");
    setParentEmail("");
  };

  // Search existing users (by name, or by email when search includes @) — club-scoped
  const searchClubProfiles = async (term: string): Promise<ExistingUser[]> => {
    const { data } = await supabase.rpc("search_invitable_profiles", {
      _query: term,
      _limit: 6,
      _club_id: clubId ?? null,
    });
    return ((data || []) as Array<{ id: string; display_name: string | null; avatar_url: string | null }>)
      .filter(u => u.id !== user?.id)
      .map(u => ({ id: u.id, display_name: u.display_name, avatar_url: u.avatar_url })) as ExistingUser[];
  };

  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["second-parent-search", debouncedSearch, clubId],
    queryFn: async (): Promise<ExistingUser[]> => {
      if (debouncedSearch.length < 2) return [];

      if (isEmailSearch) {
        // Email lookup via RPC -> profile join
        const { data: emailRows } = await supabase.rpc("get_user_by_email_for_passkey", {
          lookup_email: debouncedSearch.trim().toLowerCase(),
        });
        const userId = Array.isArray(emailRows) ? emailRows[0]?.id : (emailRows as any)?.id;
        if (!userId) {
          // Fallback: club-scoped substring match against display_name
          return await searchClubProfiles(debouncedSearch);
        }
        // Only surface the matched user when they are inside the active club
        const inClub = await searchClubProfiles(debouncedSearch.trim().toLowerCase());
        const { data: profile } = await selectCachedProfileById(userId);
        if (!profile || profile.id === user?.id) return [];
        if (!inClub.some(u => u.id === profile.id)) return [];
        return [{ ...profile, email: debouncedSearch.trim().toLowerCase() }];
      }

      return await searchClubProfiles(debouncedSearch);
    },
    enabled: open && debouncedSearch.length >= 2 && !selectedUser,
  });


  const ensureChildId = async (): Promise<string> => {
    if (childId) return childId;
    const newChildId = crypto.randomUUID();
    const { error: childError } = await supabase.from("children").insert({
      id: newChildId,
      parent_id: null,
      name: playerName,
    });
    if (childError) throw new Error(`Couldn't prepare child record: ${childError.message}`);
    await supabase
      .from("mini_league_players")
      .update({ child_id: newChildId })
      .eq("id", playerId);
    return newChildId;
  };

  // Link an existing user directly as a guardian (no email invite)
  const linkExistingMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) throw new Error("No user selected");
      if (!user?.id) throw new Error("Not signed in");
      const resolvedChildId = await ensureChildId();
      const { error } = await supabase.from("child_guardians").insert({
        child_id: resolvedChildId,
        guardian_id: selectedUser.id,
        relationship_type: "parent",
        is_primary: false,
      } as any);
      if (error && !error.message?.toLowerCase().includes("duplicate")) throw error;

      // Notify the linked parent (in-app notification — push fires via trigger)
      const { data: actor } = await selectCachedProfileById(user.id);
      const actorName = actor?.display_name || "An admin";
      await supabase.from("notifications").insert({
        user_id: selectedUser.id,
        type: "guardian_added",
        message: `${actorName} added you as a parent of ${playerName} in ${miniLeagueName}`,
        club_id: clubId,
        related_id: resolvedChildId,
      } as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
      queryClient.invalidateQueries({ queryKey: ["child_guardians"] });
      toast.success(`${selectedUser?.display_name || "Parent"} linked to ${playerName}`);
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to link parent"),
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = parentName.trim();
      const trimmedEmail = parentEmail.trim().toLowerCase();
      if (!trimmedName) throw new Error("Enter the parent's name");
      if (!emailRe.test(trimmedEmail)) throw new Error("Enter a valid email");
      if (!user?.id) throw new Error("Not signed in");

      const resolvedChildId = await ensureChildId();

      const inviteToken = crypto.randomUUID();
      const inviteMetadata: Json = {
        mini_league_id: miniLeagueId,
        child_id: resolvedChildId,
        player_id: playerId,
        player_name: playerName,
        children: [{ name: playerName, yearOfBirth: null }],
        is_additional_guardian: true,
      };

      const invitePayload: Database["public"]["Tables"]["pending_invites"]["Insert"] = {
        club_id: clubId,
        role: "parent",
        invited_user_id: null,
        invited_by_user_id: user.id,
        invited_label: trimmedName,
        invited_email: trimmedEmail,
        invite_token: inviteToken,
        metadata: inviteMetadata,
      };

      const { error: inviteError } = await supabase.from("pending_invites").insert(invitePayload);
      if (inviteError) throw new Error(inviteError.message);

      const { data: clubBranding } = await supabase
        .from("clubs")
        .select("name, logo_url, contact_email")
        .eq("id", clubId)
        .maybeSingle();

      const link = `${window.location.origin}/join/p/${inviteToken}`;
      const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
        body: {
          to: trimmedEmail,
          subject: `You're invited to ${miniLeagueName}`,
          template: "team-invite",
          senderName: clubBranding?.name || undefined,
          replyTo: clubBranding?.contact_email || undefined,
          templateData: {
            recipientName: trimmedName,
            teamName: miniLeagueName,
            clubName: clubBranding?.name || "The Club",
            roleName: "Parent",
            inviteLink: link,
            clubLogoUrl: clubBranding?.logo_url || undefined,
            childrenNames: [playerName],
            isMiniLeague: true,
          },
        },
      });

      const sent = !funcError && emailResult?.verified && emailResult?.success;
      await supabase
        .from("pending_invites")
        .update({
          email_sent_at: sent ? new Date().toISOString() : null,
          email_id: emailResult?.emailId || null,
          email_error: funcError?.message || (!sent ? "Email not verified" : null),
        })
        .eq("invite_token", inviteToken);

      return sent;
    },
    onSuccess: (sent) => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      toast.success(sent ? "Invite sent to second parent" : "Invite created (email pending)");
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const showInviteFields = !selectedUser;
  const busy = inviteMutation.isPending || linkExistingMutation.isPending;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Invite Second Parent
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Search for an existing parent by name or email, or invite a new one for{" "}
            <span className="font-medium">{playerName}</span>.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-3 px-4 py-2">
          {selectedUser ? (
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
              <Avatar className="h-9 w-9">
                <AvatarImage src={selectedUser.avatar_url || undefined} />
                <AvatarFallback className="bg-primary/20 text-primary text-sm">
                  {selectedUser.display_name?.[0]?.toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {selectedUser.display_name || "Unknown"}
                </p>
                {selectedUser.email && (
                  <p className="text-xs text-muted-foreground truncate">{selectedUser.email}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setSelectedUser(null);
                  setSearchTerm("");
                }}
              >
                Change
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="second-parent-search">Search existing parents</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="second-parent-search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Name or email"
                  className="pl-9"
                  autoComplete="off"
                />
              </div>

              {isSearching && debouncedSearch.length >= 2 && (
                <div className="flex items-center gap-2 py-1.5 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Searching...
                </div>
              )}

              {!isSearching && searchResults.length > 0 && (
                <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border bg-muted/30 p-1.5">
                  <p className="text-xs font-medium text-muted-foreground px-2 pt-1 pb-0.5">
                    Tap to link existing user:
                  </p>
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => setSelectedUser(result)}
                      className="w-full flex items-center gap-3 p-2 rounded-lg bg-background hover:bg-primary/5 active:bg-primary/10 border border-transparent hover:border-primary/30 transition-colors text-left touch-manipulation"
                    >
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={result.avatar_url || undefined} />
                        <AvatarFallback className="bg-primary/20 text-primary text-xs">
                          {result.display_name?.[0]?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium flex-1 truncate">
                        {result.display_name || "Unknown"}
                      </span>
                      <span className="text-[10px] text-primary font-medium uppercase tracking-wide">
                        Link
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {!isSearching && debouncedSearch.length >= 2 && searchResults.length === 0 && (
                <p className="text-xs text-muted-foreground py-1">
                  No matching users found — invite as new below.
                </p>
              )}
            </div>
          )}

          {showInviteFields && (
            <div className="space-y-3 pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground">Or invite a new parent</p>
              <div className="space-y-1.5">
                <Label htmlFor="second-parent-name">Parent name</Label>
                <Input
                  id="second-parent-name"
                  value={parentName}
                  onChange={(e) => setParentName(e.target.value)}
                  placeholder="Jane Smith"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="second-parent-email">Parent email</Label>
                <Input
                  id="second-parent-email"
                  type="email"
                  value={parentEmail}
                  onChange={(e) => setParentEmail(e.target.value)}
                  placeholder="redacted@example.invalid"
                  autoComplete="off"
                />
              </div>
            </div>
          )}
        </div>

        <ResponsiveDialogFooter className="px-4 pb-safe gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {selectedUser ? (
            <Button onClick={() => linkExistingMutation.mutate()} disabled={busy}>
              {linkExistingMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4 mr-1.5" />
              )}
              Link Parent
            </Button>
          ) : (
            <Button onClick={() => inviteMutation.mutate()} disabled={busy}>
              {inviteMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4 mr-1.5" />
              )}
              Send Invite
            </Button>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
