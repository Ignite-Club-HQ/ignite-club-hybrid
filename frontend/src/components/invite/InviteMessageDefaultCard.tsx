import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquareQuote, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const INVITE_MESSAGE_MAX = 500;

interface Props {
  /** Which record holds the saved default. */
  scope: "club" | "competition";
  scopeId: string;
  /** Optional heading override. */
  title?: string;
  description?: string;
}

/**
 * Saved default personal message added to invite emails. It pre-fills the
 * message box shown when sending an invite, and each sender can still change
 * or clear it for that one send.
 */
export function InviteMessageDefaultCard({ scope, scopeId, title, description }: Props) {
  const queryClient = useQueryClient();
  const table = scope === "club" ? "clubs" : "competitions";
  const queryKey = ["invite-email-message", scope, scopeId];

  const { data: saved, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table as "clubs")
        .select("invite_email_message")
        .eq("id", scopeId)
        .maybeSingle();
      if (error) throw error;
      return ((data as { invite_email_message?: string | null } | null)?.invite_email_message ?? "") as string;
    },
  });

  const [value, setValue] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (saved !== undefined && !dirty) setValue(saved ?? "");
  }, [saved, dirty]);

  const saveMutation = useMutation({
    mutationFn: async (message: string) => {
      const trimmed = message.trim();
      const { error } = await supabase
        .from(table as "clubs")
        .update({ invite_email_message: trimmed.length > 0 ? trimmed : null })
        .eq("id", scopeId);
      if (error) throw error;
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey });
      toast.success("Invite message saved");
    },
    onError: (e: Error) => toast.error("Couldn't save message: " + e.message),
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareQuote className="h-5 w-5" />
          {title ?? "Personal message in invites"}
        </CardTitle>
        <CardDescription>
          {description ??
            (scope === "club"
              ? "Added near the top of invite emails sent to new members and parents. Whoever sends an invite can still change it for that invite."
              : "Added near the top of invite emails sent to teams for this competition. Whoever sends an invite can still change it for that invite.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          value={value}
          onChange={(e) => {
            setValue(e.target.value.slice(0, INVITE_MESSAGE_MAX));
            setDirty(true);
          }}
          rows={4}
          placeholder="e.g. We're excited to have you with us this season — training starts the first week of March."
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {value.length}/{INVITE_MESSAGE_MAX}
          </span>
          <div className="flex gap-2">
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setValue(saved ?? "");
                  setDirty(false);
                }}
              >
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              disabled={!dirty || saveMutation.isPending}
              onClick={() => saveMutation.mutate(value)}
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default InviteMessageDefaultCard;
