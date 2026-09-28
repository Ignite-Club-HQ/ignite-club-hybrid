import { ReportContentDialog, type ReportReason } from "@/components/reporting/ReportContentDialog";

interface ReportCommentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  commentId: string;
}

const REPORT_REASONS: readonly ReportReason[] = [
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "offensive", label: "Offensive or harmful" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "spam", label: "Spam or misleading" },
  { value: "other", label: "Other" },
];

export function ReportCommentDialog({ isOpen, onClose, commentId }: ReportCommentDialogProps) {
  return (
    <ReportContentDialog
      isOpen={isOpen}
      onClose={onClose}
      subject="Comment"
      description="Help us maintain a safe community by reporting inappropriate comments. All reports are reviewed and actioned within 24 hours."
      question="Why are you reporting this comment?"
      reasons={REPORT_REASONS}
      radioIdPrefix="comment"
      detailsId="comment-details"
      invokeName="send-comment-report-email"
      buildBody={(reason, additionalDetails) => ({
        commentId,
        reason,
        additionalDetails,
      })}
    />
  );
}
