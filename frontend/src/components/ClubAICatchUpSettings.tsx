import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Loader2, Users, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { toast } from "sonner";

interface Props {
  clubId: string;
}

export function ClubAICatchUpSettings({ clubId }: Props) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: club, isLoading } = useQuery({
    queryKey: ["club-ai-catchup", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, ai_catch_up_enabled")
        .eq("id", clubId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: hasJuniorTeams } = useQuery({
    queryKey: ["club-has-junior-teams", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("teams")
        .select("id")
        .eq("club_id", clubId)
        .eq("team_type", "junior")
        .limit(1);
      return (data?.length ?? 0) > 0;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (ai_catch_up_enabled: boolean) => {
      const { error } = await supabase
        .from("clubs")
        .update({ ai_catch_up_enabled } as any)
        .eq("id", clubId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-ai-catchup", clubId] });
      queryClient.invalidateQueries({ queryKey: ["user-has-any-ai-catchup-club"] });
      queryClient.invalidateQueries({ queryKey: ["club-ai-catchup-flag"] });
      toast.success("AI Chat Recap updated");
    },
    onError: (e: Error) => toast.error("Failed to update: " + e.message),
  });

  const enableAllMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "enable_ai_catch_up_for_all_club_members" as any,
        { p_club_id: clubId }
      );
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: (count) => {
      toast.success(
        count > 0
          ? `Turned on AI Chat Recap for ${count} member${count === 1 ? "" : "s"}`
          : "All members already had it enabled"
      );
      setConfirmOpen(false);
    },
    onError: (e: Error) => toast.error("Failed: " + e.message),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const enabled = (club as any)?.ai_catch_up_enabled ?? true;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          AI Chat Recap
        </CardTitle>
        <CardDescription>
          Control whether members can use AI summaries to catch up on chat threads in your club
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasJuniorTeams && (
          <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-amber-900 dark:text-amber-200">
              <strong>Junior teams detected.</strong> Stricter defaults apply: only club admins can use AI Chat Recap when this toggle is off, and threads about safeguarding, medical or disciplinary matters are always blocked from AI summaries.
            </p>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="space-y-1 pr-4">
            <Label htmlFor="ai-catchup-enabled" className="text-base font-medium">
              Enable AI Chat Recap
            </Label>
            <p className="text-sm text-muted-foreground">
              When on, members see the "Chat Recap" card and menu option in team, club and group chats and can generate AI summaries of recent messages. Turn off to disable the feature across this club.
            </p>
          </div>
          <Switch
            id="ai-catchup-enabled"
            checked={enabled}
            onCheckedChange={(v) => updateMutation.mutate(v)}
            disabled={updateMutation.isPending}
          />
        </div>
        {updateMutation.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving...
          </div>
        )}

        {enabled && (
          <div className="pt-3 border-t space-y-2">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Turn on for all members</Label>
              <p className="text-xs text-muted-foreground">
                Enables AI Chat Recap on every member's account in this club. Members can still turn it off individually in their own Settings.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={enableAllMutation.isPending}
            >
              {enableAllMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Users className="h-4 w-4 mr-2" />
              )}
              Enable for all members
            </Button>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable AI Chat Recap for all members?</AlertDialogTitle>
            <AlertDialogDescription>
              This switches on AI Chat Recap on every member's profile in this club. Individual members can opt out again from their own Settings at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enableAllMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                enableAllMutation.mutate();
              }}
              disabled={enableAllMutation.isPending}
            >
              {enableAllMutation.isPending ? "Enabling..." : "Enable for all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
