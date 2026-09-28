import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAcknowledged: () => void;
}

/**
 * First-use disclosure shown before any AI summary is generated. The user must
 * confirm they're 18+ and understand that recent messages will be sent (with
 * PII stripped) to Google Gemini. Acknowledgement is stored on the profile.
 */
export function AICatchUpDisclosureDialog({ open, onOpenChange, onAcknowledged }: Props) {
  const [saving, setSaving] = useState(false);

  const accept = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc("acknowledge_ai_catch_up_disclosure" as any);
      if (error) throw error;
      onOpenChange(false);
      onAcknowledged();
    } catch (e: any) {
      toast.error("Couldn't save: " + (e?.message ?? "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Before you use AI Chat Recap
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                We send the most recent messages from this chat to Google Gemini to generate a short summary.
                Names, contact details and other personal info are stripped before sending. Messages are not used to train AI models.
              </p>
              <p>
                Threads about medical, safeguarding or disciplinary matters are automatically blocked and never sent to AI.
              </p>
              <p className="text-foreground">
                By continuing you confirm you are <strong>18 or older</strong> and you've read our{" "}
                <a href="/privacy" className="underline">Privacy Policy</a>.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Not now</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void accept();
            }}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            I'm 18+, continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
