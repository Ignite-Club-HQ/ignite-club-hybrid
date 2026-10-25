import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { submitLiveFeedback } from "@/live/features/insights";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { encodeFeedbackMessage } from "@/lib/feedbackFields";

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gapDiagnostic?: string;
}

export function FeedbackDialog({ open, onOpenChange, gapDiagnostic }: FeedbackDialogProps) {
  const [type, setType] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useAuth();
  useEffect(() => {
    if (open && gapDiagnostic) {
      setType("bug");
      setTitle("Something isn’t working");
      setDescription("");
    }
  }, [open, gapDiagnostic]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !type || !title.trim()) return;

    setIsSubmitting(true);
    const reportDescription = [description.trim(), gapDiagnostic ? `Support reference: ${gapDiagnostic}` : ""].filter(Boolean).join("\n\n");
    let emailFailed = false;
    const notifySupport = async () => {
      try {
        const { error } = await supabase.functions.invoke("send-feedback-email", {
          body: { type, title: title.trim(), description: reportDescription || null, userEmail: user.email ?? null, userName: user.user_metadata?.display_name || user.email || "Ignite member" },
        });
        emailFailed = Boolean(error);
      } catch { emailFailed = true; }
    };
    try {
      await withFeatureBackend("admin", {
        supabase: async () => {
          const { error: feedbackError } = await supabase.from("feedback").insert({
            user_id: user.id,
            type,
            message: title.trim(),
            title: title.trim(),
            description: reportDescription || null,
          });

          if (feedbackError) throw feedbackError;

          await notifySupport();
        },
        icp: async (ctx) => {
          await submitLiveFeedback(ctx, type, title.trim(), encodeFeedbackMessage(reportDescription), null);
          // Explicit fixed-purpose support transport; feedback stays on-chain.
          await notifySupport();
        },
      });

      if (emailFailed) toast.warning("Your feedback was saved, but the support email could not be confirmed.");
      else toast.success("Thanks for your feedback!");
      onOpenChange(false);
      setType("");
      setTitle("");
      setDescription("");
    } catch (error) {
      console.error("Error submitting feedback:", error);
      toast.error("Failed to submit feedback");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Send Feedback</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Help us improve Ignite by reporting bugs or suggesting features.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <div className="relative">
              <select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="flex h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                required
              >
                <option value="" disabled>Select feedback type</option>
                <option value="feature_request">Feature Request</option>
                <option value="bug">Bug Report</option>
                <option value="other">Other</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-50 pointer-events-none" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief summary"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide more details..."
              rows={4}
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting || !type || !title.trim()}
          >
            {isSubmitting ? "Submitting..." : "Submit Feedback"}
          </Button>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
