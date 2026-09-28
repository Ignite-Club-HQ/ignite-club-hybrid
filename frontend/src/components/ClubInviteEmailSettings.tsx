import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
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

  const { data: club, isLoading } = useQuery({
    queryKey: ["club-invite-email-style", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, invite_email_style")
        .eq("id", clubId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (invite_email_style: InviteEmailStyle) => {
      const { error } = await supabase
        .from("clubs")
        .update({ invite_email_style })
        .eq("id", clubId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-invite-email-style", clubId] });
      toast.success("Invite email style updated");
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
      </CardContent>
    </Card>
  );
}

export default ClubInviteEmailSettings;
