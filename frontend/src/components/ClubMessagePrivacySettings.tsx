import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { EyeOff, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  clubId: string;
}

export function ClubMessagePrivacySettings({ clubId }: Props) {
  const queryClient = useQueryClient();

  const { data: club, isLoading } = useQuery({
    queryKey: ["club-message-privacy", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, force_disable_message_previews")
        .eq("id", clubId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (force_disable_message_previews: boolean) => {
      const { error } = await supabase
        .from("clubs")
        .update({ force_disable_message_previews })
        .eq("id", clubId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-message-privacy", clubId] });
      toast.success("Message privacy updated");
    },
    onError: (e: Error) => toast.error("Failed to update: " + e.message),
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

  const forceDisabled = (club as any)?.force_disable_message_previews ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <EyeOff className="h-5 w-5" />
          Message Privacy
        </CardTitle>
        <CardDescription>
          Control whether message previews appear in push notifications for your club
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1 pr-4">
            <Label htmlFor="force-disable-previews" className="text-base font-medium">
              Hide message text in push notifications
            </Label>
            <p className="text-sm text-muted-foreground">
              When on, push notifications for messages in this club hide the message text on lock screens for every member. Sender names and the conversation are always shown — only the message body is replaced with "New message".
            </p>

          </div>
          <Switch
            id="force-disable-previews"
            checked={forceDisabled}
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
      </CardContent>
    </Card>
  );
}
