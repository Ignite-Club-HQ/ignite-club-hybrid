import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  LEGAL_REACCEPTANCE_CONFIRM_PHRASE,
  LEGAL_REACCEPTANCE_KEY,
  fetchLegalReacceptanceSetting,
} from "@/hooks/useLegalReacceptance";

/**
 * App-admin only control for forcing every user to re-read and accept the
 * Terms & Privacy Policy on their next app open.
 *
 * Deliberately hard to enable: a confirmation dialog, a required version label
 * and an exact typed confirmation phrase (also enforced server-side in the
 * `set_legal_reacceptance` RPC, which additionally requires the app_admin role
 * and writes an audit-log entry).
 */
export function LegalReacceptanceAdminCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [version, setVersion] = useState("");
  const [summary, setSummary] = useState("");
  const [phrase, setPhrase] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: setting, isPending } = useQuery({
    queryKey: ["app-setting", LEGAL_REACCEPTANCE_KEY],
    queryFn: fetchLegalReacceptanceSetting,
    staleTime: 60 * 1000,
  });

  const isOn = setting?.required === true;

  const apply = async (required: boolean) => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc("set_legal_reacceptance" as never, {
        _required: required,
        _confirmation: required ? phrase.trim() : null,
        _version: required ? version.trim() : null,
        _summary: required ? summary.trim() || null : null,
      } as never);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["app-setting", LEGAL_REACCEPTANCE_KEY] });
      toast({
        title: required
          ? "Re-acceptance required for all users"
          : "Re-acceptance requirement turned off",
      });
      setDialogOpen(false);
      setPhrase("");
      setVersion("");
      setSummary("");
    } catch (e) {
      toast({
        title: "Couldn't update setting",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={isOn ? "border-destructive/40" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-destructive" />
          Force Terms &amp; Privacy re-acceptance
        </CardTitle>
        <CardDescription>
          When on, every user is blocked by a full-screen prompt on their next app open until
          they read and accept the Terms of Service and Privacy Policy. Off by default — only
          turn this on after the legal documents actually change.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Require re-acceptance</Label>
            <p className="text-sm text-muted-foreground">
              {isPending
                ? "Checking…"
                : isOn
                  ? `On — version ${setting?.version ?? "—"}, effective ${
                      setting?.effective_at
                        ? new Date(setting.effective_at).toLocaleString()
                        : "—"
                    }`
                  : "Off — no users are being prompted"}
            </p>
          </div>
          <Switch
            checked={isOn}
            disabled={isPending || saving}
            onCheckedChange={(next) => {
              if (next) setDialogOpen(true);
              else void apply(false);
            }}
            aria-label="Require all users to re-accept Terms and Privacy Policy"
          />
        </div>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={(o) => !saving && setDialogOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Force every user to re-accept?</DialogTitle>
            <DialogDescription>
              This blocks all users — on web and native — until they accept. This action is
              recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="legal-version">Version label (required)</Label>
              <Input
                id="legal-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="e.g. 2026-08-01"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="legal-summary">What changed (optional)</Label>
              <Textarea
                id="legal-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Shown to users in the prompt"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="legal-phrase">
                Type <span className="font-mono">{LEGAL_REACCEPTANCE_CONFIRM_PHRASE}</span> to confirm
              </Label>
              <Input
                id="legal-phrase"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                saving ||
                version.trim().length === 0 ||
                phrase.trim() !== LEGAL_REACCEPTANCE_CONFIRM_PHRASE
              }
              onClick={() => void apply(true)}
            >
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Turn on
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
