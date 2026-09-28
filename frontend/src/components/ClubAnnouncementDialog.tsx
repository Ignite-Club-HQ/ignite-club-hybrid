import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, Megaphone, Loader2 } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { supabase } from "@/integrations/supabase/client";
import { refreshSessionOnce } from "@/lib/refreshSessionOnce";


interface Team {
  id: string;
  name: string;
  logo_url: string | null;
  is_archived?: boolean;
}

interface ClubAnnouncementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubName: string;
  clubId: string;
  teams: Team[];
  userId: string;
}

export function ClubAnnouncementDialog({
  open,
  onOpenChange,
  clubName,
  clubId,
  teams,
  userId,
}: ClubAnnouncementDialogProps) {
  const [message, setMessage] = useState("");
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set());
  const [sendToClubChat, setSendToClubChat] = useState(false);

  const activeTeams = useMemo(() => teams.filter((t) => !t.is_archived), [teams]);
  const activeTeamIds = useMemo(
    () => new Set(activeTeams.map((t) => t.id).filter(Boolean)),
    [activeTeams],
  );

  // Teams can be archived or refetched while the dialog is open. Prune the
  // selection so a stale id can never reach the edge function (which rejects
  // the whole payload with a 400 if any id is not a live team of this club).
  useEffect(() => {
    setSelectedTeamIds((prev) => {
      const next = new Set([...prev].filter((id) => activeTeamIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [activeTeamIds]);

  const toggleTeam = (teamId: string) => {
    setSelectedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedTeamIds.size === activeTeams.length) {
      setSelectedTeamIds(new Set());
    } else {
      setSelectedTeamIds(new Set(activeTeams.map((t) => t.id)));
    }
  };

  /** Exactly what gets sent: selection ∩ live active teams, deduped, no falsy. */
  const resolvedTeamIds = useMemo(
    () => [...new Set([...selectedTeamIds].filter((id) => id && activeTeamIds.has(id)))],
    [selectedTeamIds, activeTeamIds],
  );

  const sendMutation = useMutation({
    mutationFn: async () => {
      const teamIds = resolvedTeamIds;
      const trimmed = message.trim();

      // Client-side guard: never invoke the function with a payload it must
      // reject. Keeps the button state and the real payload in sync.
      if (!trimmed) throw new Error("Write a message before sending.");
      if (teamIds.length === 0 && !sendToClubChat) {
        throw new Error("Pick at least one team or the club chat.");
      }

      const parsed = z
        .object({
          club_id: z.string().uuid(),
          team_ids: z.array(z.string().uuid()),
          message: z.string().trim().min(1).max(4000),
        })
        .refine((v) => v.team_ids.length > 0 || sendToClubChat, {
          message: "Pick at least one team or the club chat.",
        })
        .safeParse({ club_id: clubId, team_ids: teamIds, message: trimmed });

      if (!parsed.success) {
        throw new Error(
          parsed.error.issues[0]?.message || "That announcement isn't valid — please check it.",
        );
      }


      // Make sure we send a live access token: a stale/expired session is the
      // most common cause of a 401 from the announcement function.
      let { data: sessionData } = await supabase.auth.getSession();
      let accessToken = sessionData.session?.access_token ?? null;
      const expiresAt = sessionData.session?.expires_at ?? 0;
      if (!accessToken || expiresAt * 1000 - Date.now() < 60_000) {
        const { session: refreshed } = await refreshSessionOnce(10000);
        accessToken = refreshed?.access_token ?? accessToken;
      }
      if (!accessToken) {
        throw new Error("Your session expired. Please sign in again.");
      }

      // Send via edge function which creates/uses bot profile as author
      // This makes announcements backwards-compatible with old app builds
      const { data, error } = await supabase.functions.invoke("send-club-announcement", {
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          club_id: parsed.data.club_id,
          team_ids: parsed.data.team_ids,
          include_club_chat: sendToClubChat,
          message: parsed.data.message,
          club_name: clubName,
        },
      });

      if (error) {
        // Surface the function's JSON error body instead of a generic message.
        // NOTE: the body read must not throw inside the try — otherwise the
        // catch swallows the real reason and we fall back to the generic error.
        const ctx = (error as { context?: Response }).context;
        let serverMessage: string | null = null;
        if (ctx && typeof ctx.json === "function") {
          try {
            const body = await ctx.json();
            if (body?.error) serverMessage = String(body.error);
          } catch {
            try {
              const text = await ctx.text?.();
              if (text) serverMessage = text.slice(0, 300);
            } catch {
              /* body already consumed or empty */
            }
          }
        }
        throw new Error(serverMessage || (error as Error).message || "Request failed");
      }
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      const parts: string[] = [];
      if (resolvedTeamIds.length > 0) {
        parts.push(`${resolvedTeamIds.length} team${resolvedTeamIds.length > 1 ? "s" : ""}`);
      }
      if (sendToClubChat) parts.push("club chat");
      toast.success(`Announcement sent to ${parts.join(" and ")}`);
      setMessage("");
      setSelectedTeamIds(new Set());
      setSendToClubChat(false);
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg ? `Couldn't send announcement: ${msg}` : "Failed to send announcement");
    },
  });


  const canSend =
    message.trim().length > 0 &&
    (resolvedTeamIds.length > 0 || sendToClubChat) &&
    !sendMutation.isPending;



  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            Send Announcement
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-4 py-2 flex-1 min-h-0 overflow-y-auto">
          {/* From label */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
            <span className="text-xs text-muted-foreground">From:</span>
            <span className="text-sm font-medium">{clubName}</span>
          </div>

          {/* Message input */}
          <div className="space-y-1.5">
            <Label htmlFor="announcement-message">Message</Label>
            <Textarea
              id="announcement-message"
              placeholder="Write your announcement..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          {/* Club chat destination */}
          <div className="space-y-2">
            <Label>Send to club chat</Label>
            <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50">
              <Checkbox
                checked={sendToClubChat}
                onCheckedChange={(checked) => setSendToClubChat(checked === true)}
              />
              <span className="text-sm">
                {clubName} club chat
                <span className="block text-xs text-muted-foreground">
                  Posted by the club account to all club members
                </span>
              </span>
            </label>
          </div>



          {/* Team selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Send to teams</Label>
              <Button variant="ghost" size="sm" onClick={selectAll} className="text-xs h-7">
                {selectedTeamIds.size === activeTeams.length ? "Deselect All" : "Select All"}
              </Button>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1 border rounded-lg p-2">
              {activeTeams.map((team) => (
                <label
                  key={team.id}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedTeamIds.has(team.id)}
                    onCheckedChange={() => toggleTeam(team.id)}
                  />
                  <span className="text-sm">{team.name}</span>
                </label>
              ))}
              {activeTeams.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No teams available</p>
              )}
            </div>
            {selectedTeamIds.size > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedTeamIds.size} team{selectedTeamIds.size > 1 ? "s" : ""} selected
              </p>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 pt-3 pb-1 bg-background border-t mt-2">
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={!canSend}
            className="w-full"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send Announcement
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
