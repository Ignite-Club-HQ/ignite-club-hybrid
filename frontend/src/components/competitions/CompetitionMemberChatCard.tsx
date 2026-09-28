import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  competitionId: string;
}

/**
 * Opt-in competition-wide chat. Enabling it creates (or restores) the
 * "<Competition> – All Members" thread; membership is synced server-side from
 * team roles of entered teams.
 */
export function CompetitionMemberChatCard({ competitionId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["competition-member-chat", competitionId],
    enabled: !!competitionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitions")
        .select("member_chat_enabled, member_chat_admins_only")
        .eq("id", competitionId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const enabled = !!data?.member_chat_enabled;
  const adminsOnly = !!data?.member_chat_admins_only;

  const update = async (patch: {
    member_chat_enabled?: boolean;
    member_chat_admins_only?: boolean;
  }) => {
    const { error } = await supabase
      .from("competitions")
      .update(patch)
      .eq("id", competitionId);
    if (error) {
      toast({ title: "Could not update", description: error.message, variant: "destructive" });
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
            onCheckedChange={(next) => update({ member_chat_enabled: next })}
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
            onCheckedChange={(next) => update({ member_chat_admins_only: next })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
