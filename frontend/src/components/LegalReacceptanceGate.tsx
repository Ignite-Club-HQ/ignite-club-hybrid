import { useState } from "react";
import { FileText, ShieldCheck, Loader2, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useLegalReacceptance } from "@/hooks/useLegalReacceptance";
import { toast } from "sonner";

const TERMS_URL = "https://reference.invalid";
const PRIVACY_URL = "https://reference.invalid";

/**
 * Blocking gate shown after sign-in when an app admin has explicitly turned on
 * "require re-acceptance". It is inert by default — see useLegalReacceptance,
 * which fails closed to "not required".
 */
export function LegalReacceptanceGate() {
  const { mustAccept, setting, refresh } = useLegalReacceptance();
  const [readTerms, setReadTerms] = useState(false);
  const [readPrivacy, setReadPrivacy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!mustAccept) return null;

  const accept = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc("accept_current_legal_terms" as never);
      if (error) throw error;
      toast.success("Thanks — your acceptance has been recorded.");
      refresh();
    } catch (e) {
      toast.error("Couldn't record your acceptance. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const canAccept = readTerms && readPrivacy && agreed && !saving;

  return (
    <Dialog open>
      <DialogContent
        className="max-w-md [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Updated Terms &amp; Privacy Policy
          </DialogTitle>
          <DialogDescription>
            {setting.summary
              ? setting.summary
              : "We've updated our legal documents. Please read and accept them to continue using Ignite."}
            {setting.version ? ` (version ${setting.version})` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border border-border p-3 space-y-3">
            <a
              href={TERMS_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setReadTerms(true)}
              className="flex items-center justify-between text-sm font-medium text-primary hover:underline"
            >
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4" /> Read Terms of Service
              </span>
              <ExternalLink className="h-4 w-4" />
            </a>
            <a
              href={PRIVACY_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setReadPrivacy(true)}
              className="flex items-center justify-between text-sm font-medium text-primary hover:underline"
            >
              <span className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Read Privacy Policy
              </span>
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              aria-label="I have read and accept the Terms of Service and Privacy Policy"
            />
            <span className="text-muted-foreground">
              I have read and accept the updated Terms of Service and Privacy Policy.
            </span>
          </label>

          {(!readTerms || !readPrivacy) && (
            <p className="text-xs text-muted-foreground">
              Open both documents above before accepting.
            </p>
          )}

          <Button className="w-full" disabled={!canAccept} onClick={() => void accept()}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Accept and continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
