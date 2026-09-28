import { useState } from "react";
import { Flag, Loader2 } from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ReportReason {
  value: string;
  label: string;
}

interface ReportContentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  subject: string;
  description: string;
  question: string;
  reasons: readonly ReportReason[];
  radioIdPrefix: string;
  detailsId: string;
  invokeName: string;
  buildBody: (reason: string, additionalDetails: string | undefined) => Record<string, unknown>;
}

export function ReportContentDialog({
  isOpen,
  onClose,
  subject,
  description,
  question,
  reasons,
  radioIdPrefix,
  detailsId,
  invokeName,
  buildBody,
}: ReportContentDialogProps) {
  const [reason, setReason] = useState("");
  const [additionalDetails, setAdditionalDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleClose = () => {
    setReason("");
    setAdditionalDetails("");
    onClose();
  };

  const handleSubmit = async () => {
    if (!reason) {
      toast.error("Please select a reason for your report");
      return;
    }

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error(`You must be logged in to report a ${subject.toLowerCase()}`);
        return;
      }

      const response = await supabase.functions.invoke(invokeName, {
        body: buildBody(
          reasons.find((option) => option.value === reason)?.label || reason,
          additionalDetails.trim() || undefined,
        ),
      });
      if (response.error) throw new Error(response.error.message);

      toast.success("Report submitted successfully. Our team will review it.");
      handleClose();
    } catch (error) {
      console.error(`Failed to submit ${subject.toLowerCase()} report:`, error);
      toast.error("Failed to submit report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={handleClose}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-base">
            <Flag className="h-5 w-5 text-destructive shrink-0" />
            Report {subject}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="text-sm">
            {description}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4 py-2 px-4">
          <div className="space-y-3">
            <Label className="text-sm font-medium">{question}</Label>
            <RadioGroup value={reason} onValueChange={setReason} className="space-y-2">
              {reasons.map((option) => {
                const id = `${radioIdPrefix}-${option.value}`;
                return (
                  <div key={option.value} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/50 -mx-2">
                    <RadioGroupItem value={option.value} id={id} />
                    <Label htmlFor={id} className="font-normal cursor-pointer text-sm flex-1">
                      {option.label}
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor={detailsId} className="text-sm font-medium">Additional details (optional)</Label>
            <Textarea
              id={detailsId}
              placeholder="Provide any additional context..."
              value={additionalDetails}
              onChange={(event) => setAdditionalDetails(event.target.value)}
              rows={3}
              maxLength={500}
              className="resize-none text-base"
            />
            <p className="text-xs text-muted-foreground text-right">
              {additionalDetails.length}/500
            </p>
          </div>
        </div>

        <ResponsiveDialogFooter className="flex-col gap-2 px-4 pb-4">
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={!reason || submitting}
            className="w-full"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Flag className="h-4 w-4" />
                Submit Report
              </>
            )}
          </Button>
          <Button variant="outline" onClick={handleClose} disabled={submitting} className="w-full">
            Cancel
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
