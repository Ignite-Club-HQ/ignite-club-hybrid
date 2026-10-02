import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  getLiveCompetitionChatSettings,
  setLiveCompetitionChatSettings,
} from "@/live/features/competitions";

interface Props {
  competitionId: string;
}

/**
 * Opt-in competition-wide chat. Enabling it creates (or restores) the
 * "<Competition> – All Members" thread; membership is synced server-side from
 * team roles of entered teams.
 *
 * Backend-routed: Supabase `competitions` columns or the competition_domain
 * canister's chat-settings record, depending on placement settings.
 */
export function CompetitionMemberChatCard({ competitionId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["competition-member-chat", competitionId],
    enabled: !!competitionId,
    queryFn: () =>
      withFeatureBackend("competitions", {
        supabase: async () => {
          const { data, error } = await supabase
            .from("competitions")
            .select("member_chat_enabled, member_chat_admins_only")
            .eq("id", competitionId)
            .maybeSingle();
          if (error) throw error;
          return {
            enabled: !!data?.member_chat_enabled,
            adminsOnly: !!data?.member_chat_admins_only,
            revision: 0,
          };
        },
        icp: async (ctx) => {
          const settings = await getLiveCompetitionChatSettings(ctx, competitionId);
          return {
            enabled: settings.chat_enabled,
            adminsOnly: settings.admins_only,
            revision: Number(settings.revision),
          };
        },
      }),
  });

  const enabled = !!data?.enabled;
  const adminsOnly = !!data?.adminsOnly;

  const update = async (nextEnabled: boolean, nextAdminsOnly: boolean) => {
    try {
      await withFeatureBackend("competitions", {
        supabase: async () => {
          const { error } = await supabase
            .from("competitions")
            .update({
              member_chat_enabled: nextEnabled,
              member_chat_admins_only: nextAdminsOnly,
            })
            .eq("id", competitionId);
          if (error) throw error;
        },
        icp: async (ctx) => {
          await setLiveCompetitionChatSettings(
            ctx,
            competitionId,
            nextEnabled,
            nextAdminsOnly,
            data?.revision ?? 0,
          );
        },
      });
    } catch (err: any) {
      toast({ title: "Could not update", description: err.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["competition-member-chat", competitionId] });
    qc.invalidateQueries({ queryKey: ["competition", competitionId] });
    qc.invalidateQueries({ queryKey: ["chat-groups"] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Competition-wide chat</CardTitle>
        <CardDescription>
          A single thread for everyone involved in this competition — team admins, coaches,
          players and parents of entered teams. Coordinators keep their own separate thread.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="member-chat-enabled">Enable competition-wide chat</Label>
            <p className="text-xs text-muted-foreground">
              Members of entered teams are added automatically. Turning this off hides the
              thread without deleting its history.
            </p>
          </div>
          <Switch
            id="member-chat-enabled"
            checked={enabled}
            disabled={isLoading}
            onCheckedChange={(next) => update(next, adminsOnly)}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="member-chat-admins-only">Only organisers can post</Label>
            <p className="text-xs text-muted-foreground">
              Use this for announcements — members can read and react but not send messages.
            </p>
          </div>
          <Switch
            id="member-chat-admins-only"
            checked={adminsOnly}
            disabled={isLoading || !enabled}
            onCheckedChange={(next) => update(enabled, next)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
