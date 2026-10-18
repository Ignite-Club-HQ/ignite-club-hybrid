import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { writeOnce } from "@/live/clubScope";
import { setLiveClubInviteEmailStyle } from "@/live/features/club";
import { toast } from "sonner";

interface Props {
  clubId: string;
}

type InviteEmailStyle = "detailed" | "simple" | "discover";

const OPTIONS: { value: InviteEmailStyle; title: string; description: string; sample: string }[] = [
  {
    value: "detailed",
    title: "Detailed",
    description:
      "Explains what members can do once they join, with a short feature list. Best for clubs new to Ignite.",
    sample:
      "\"Joe has been added to Under 12 Boys\" + \"Once you join, you'll be able to: see which team they're in…\"",
  },
  {
    value: "simple",
    title: "Simple",
    description:
      "Short and to the point — who has been added to which team, and a button to open it. No feature list.",
    sample: "\"Joe has been added to Under 12 Boys\" + \"Under 12 Boys is set up in Ignite.\"",
  },
  {
    value: "discover",
    title: "See which team",
    description:
      "Curiosity-led subject line inviting parents to open the app and see their child's team. Same detailed body.",
    sample: "\"Basket Range: See which team Joe is in ⚽\"",
  },
];


export function ClubInviteEmailSettings({ clubId }: Props) {
  const queryClient = useQueryClient();
  const [defaultMessageDraft, setDefaultMessageDraft] = useState("");

  const { data: club, isLoading } = useQuery({
    queryKey: ["club-invite-email-style", clubId],
    queryFn: async () =>
      withFeatureBackend("membership", {
        supabase: async () => {
          const { data, error } = await supabase
            .from("clubs")
            .select("id, invite_email_style")
            .eq("id", clubId)
            .maybeSingle();
          if (error) throw error;
          return data as { invite_email_style?: string | null } | null;
        },
        icp: async (ctx) => {
          const { getLiveClubSettings } = await import("@/live/features/club");
          const s: any = await getLiveClubSettings(ctx, clubId).catch(() => null);
          return { invite_email_style: s?.invite_email_style?.[0] ?? null };
        },
      }, { clubId: clubId! }),
  });

  const { data: savedDefaultMessage = "", isLoading: isLoadingDefaultMessage } = useQuery({
    queryKey: ["club-invite-message-default", clubId],
    queryFn: async () =>
      withFeatureBackend("membership", {
        supabase: async () => {
          const { data, error } = await supabase
            .from("club_invite_message_defaults")
            .select("message")
            .eq("club_id", clubId)
            .maybeSingle();
          if (error) throw error;
          return data?.message ?? "";
        },
        icp: async (ctx) => {
          const { getLiveClubInviteMessageDefault } = await import("@/live/features/club");
          const value = await getLiveClubInviteMessageDefault(ctx, clubId);
          return value?.message ?? "";
        },
      }, { clubId: clubId! }),
  });

  useEffect(() => setDefaultMessageDraft(savedDefaultMessage), [savedDefaultMessage]);

  const updateMutation = useMutation({
    mutationFn: async (invite_email_style: InviteEmailStyle) => {
      await withFeatureBackend("membership", {
        supabase: async () => {
          const { error } = await supabase
            .from("clubs")
            .update({ invite_email_style })
            .eq("id", clubId);
          if (error) throw error;
        },
        icp: async (ctx) => {
          await setLiveClubInviteEmailStyle(ctx, clubId, invite_email_style);
        },
      }, writeOnce({ clubId: clubId! }));
    },
    onMutate: async (style) => {
      const key = ["club-invite-email-style", clubId];
      const prev = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (old: any) => ({ ...(old ?? {}), invite_email_style: style }));
      return { prev };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-invite-email-style", clubId] });
      toast.success("Invite email style updated");
    },
    onError: (e: Error, _v, c) => {
      if (c?.prev !== undefined) queryClient.setQueryData(["club-invite-email-style", clubId], c.prev);
      toast.error("Failed to update: " + e.message);
    },
  });

  const updateDefaultMessageMutation = useMutation({
    mutationFn: async (message: string) =>
      withFeatureBackend("membership", {
        supabase: async () => {
          const { error } = await supabase
            .from("club_invite_message_defaults")
            .upsert({ club_id: clubId, message: message.trim() }, { onConflict: "club_id" });
          if (error) throw error;
        },
        icp: async (ctx) => {
          const { setLiveClubInviteMessageDefault } = await import("@/live/features/club");
          await setLiveClubInviteMessageDefault(ctx, clubId, message.trim());
        },
      }, writeOnce({ clubId: clubId! })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-invite-message-default", clubId] });
      toast.success("Default invite message updated");
    },
    onError: (error: Error) => toast.error("Failed to update: " + error.message),
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

  const raw = (club as { invite_email_style?: string } | null)?.invite_email_style;
  const current: InviteEmailStyle =
    raw === "simple" ? "simple" : raw === "discover" ? "discover" : "detailed";


  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Invite Emails
        </CardTitle>
        <CardDescription>
          Choose the wording used for invite and "added to team" emails sent to your members
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={current}
          onValueChange={(v) => updateMutation.mutate(v as InviteEmailStyle)}
          disabled={updateMutation.isPending}
          className="space-y-3"
        >
          {OPTIONS.map((opt) => (
            <Label
              key={opt.value}
              htmlFor={`invite-email-${opt.value}`}
              className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <RadioGroupItem id={`invite-email-${opt.value}`} value={opt.value} className="mt-1" />
              <div className="space-y-1">
                <p className="text-base font-medium">{opt.title}</p>
                <p className="text-sm text-muted-foreground">{opt.description}</p>
                <p className="text-xs text-muted-foreground italic">{opt.sample}</p>
              </div>
            </Label>
          ))}
        </RadioGroup>
        <div className="mt-5 space-y-2 border-t pt-4">
          <div className="space-y-1">
            <Label htmlFor={`club-invite-message-${clubId}`}>Default invite message</Label>
            <p className="text-xs text-muted-foreground">Pre-filled for team invites. Invite text can still be customized before sending.</p>
          </div>
          <Textarea
            id={`club-invite-message-${clubId}`}
            value={defaultMessageDraft}
            onChange={(event) => setDefaultMessageDraft(event.target.value.slice(0, 2000))}
            maxLength={2000}
            rows={4}
            disabled={isLoadingDefaultMessage || updateDefaultMessageMutation.isPending}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{defaultMessageDraft.length}/2000</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isLoadingDefaultMessage || updateDefaultMessageMutation.isPending || defaultMessageDraft === savedDefaultMessage}
              onClick={() => updateDefaultMessageMutation.mutate(defaultMessageDraft)}
            >
              {updateDefaultMessageMutation.isPending ? "Saving..." : "Save default"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default ClubInviteEmailSettings;
