import { writeOnce } from "@/live/clubScope";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { useToast } from "@/hooks/use-toast";

type ScopeKind = "team" | "competition";
type WelcomeEmailSettings = {
  id: string | null;
  enabled: boolean;
  subject: string;
  message: string;
};

const settingsKey = (kind: ScopeKind, id: string) => ["welcome-email-settings", kind, id] as const;

export function WelcomeEmailSettingsCard({
  scopeKind,
  scopeId,
}: {
  scopeKind: ScopeKind;
  scopeId: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const scopeColumn = scopeKind === "team" ? "team_id" : "competition_id";
  const key = settingsKey(scopeKind, scopeId);

  const loadSupabaseSettings = async () => {
    const { data: row, error } = await supabase
      .from("welcome_email_settings")
      .select("id, enabled, subject, message")
      .eq(scopeColumn, scopeId)
      .maybeSingle();
    if (error) throw error;
    return (row as WelcomeEmailSettings | null) ?? null;
  };

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (scopeKind === "team") {
        return withFeatureBackend("membership", {
          supabase: () => loadSupabaseSettings(),
          icp: async (ctx) => {
            const { getLiveTeamWelcomeEmail } = await import("@/live/features/club");
            const row = await getLiveTeamWelcomeEmail(ctx, scopeId);
            return row ? { id: null, enabled: row.enabled, subject: row.subject, message: row.message } : null;
          },
        }, { teamId: scopeId });
      }
      return withFeatureBackend("competitions", {
        supabase: () => loadSupabaseSettings(),
        icp: async (ctx) => {
          const { getLiveCompetitionWelcomeEmail } = await import("@/live/features/competitions");
          const row = await getLiveCompetitionWelcomeEmail(ctx, scopeId);
          return row ? { id: null, enabled: row.enabled, subject: row.subject, message: row.message } : null;
        },
      }, { competitionId: scopeId });
    },
  });

  useEffect(() => {
    setEnabled(data?.enabled ?? false);
    setSubject(data?.subject ?? `Welcome to {{${scopeKind === "team" ? "teamName" : "competitionName"}}}`);
    setMessage(data?.message ?? "We're glad you're here.");
  }, [data, scopeKind]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const values = {
        team_id: scopeKind === "team" ? scopeId : null,
        competition_id: scopeKind === "competition" ? scopeId : null,
        enabled,
        subject: subject.trim(),
        message: message.trim(),
        updated_by: user?.id ?? null,
      };
      if (!values.subject) throw new Error("Add an email subject.");
      if (values.subject.length > 160) throw new Error("Subject cannot exceed 160 characters.");
      if (values.message.length > 4000) throw new Error("Message cannot exceed 4000 characters.");
      if (scopeKind === "team") {
        const handled = await withFeatureBackend("membership", {
          supabase: async () => false,
          icp: async (ctx) => {
            const { setLiveTeamWelcomeEmail } = await import("@/live/features/club");
            await setLiveTeamWelcomeEmail(ctx, scopeId, { enabled, subject: values.subject, message: values.message });
            return true;
          },
        }, writeOnce({ teamId: scopeId }));
        if (handled) return;
      } else {
        const handled = await withFeatureBackend("competitions", {
          supabase: async () => false,
          icp: async (ctx) => {
            const { setLiveCompetitionWelcomeEmail } = await import("@/live/features/competitions");
            await setLiveCompetitionWelcomeEmail(ctx, scopeId, { enabled, subject: values.subject, message: values.message });
            return true;
          },
        }, writeOnce({ competitionId: scopeId }));
        if (handled) return;
      }
      if (data?.id) {
        const { error } = await supabase.from("welcome_email_settings").update(values).eq("id", data.id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("welcome_email_settings").insert(values);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      toast({ title: "Welcome email settings saved" });
    },
    onError: (error: Error) => toast({ title: "Could not save settings", description: error.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" /> Welcome email
        </CardTitle>
        <CardDescription>Optional email for members joining this {scopeKind}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={`welcome-email-enabled-${scopeId}`}>Send welcome email</Label>
          <Switch
            id={`welcome-email-enabled-${scopeId}`}
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={isLoading || saveMutation.isPending}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`welcome-email-subject-${scopeId}`}>Subject</Label>
          <Input
            id={`welcome-email-subject-${scopeId}`}
            value={subject}
            maxLength={160}
            onChange={(event) => setSubject(event.target.value)}
            disabled={isLoading || saveMutation.isPending}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`welcome-email-message-${scopeId}`}>Message</Label>
          <Textarea
            id={`welcome-email-message-${scopeId}`}
            value={message}
            maxLength={4000}
            rows={4}
            onChange={(event) => setMessage(event.target.value)}
            disabled={isLoading || saveMutation.isPending}
          />
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => saveMutation.mutate()}
          disabled={isLoading || saveMutation.isPending}
        >
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Save
        </Button>
      </CardContent>
    </Card>
  );
}