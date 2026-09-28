import { ReportContentDialog, type ReportReason } from "@/components/reporting/ReportContentDialog";

interface ReportMessageDialogProps {
  isOpen: boolean;
  onClose: () => void;
  messageId: string;
  messageType: string;
}

const REPORT_REASONS: readonly ReportReason[] = [
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "offensive", label: "Offensive or harmful" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "spam", label: "Spam or misleading" },
  { value: "other", label: "Other" },
];

export function ReportMessageDialog({
  isOpen,
  onClose,
  messageId,
  messageType,
}: ReportMessageDialogProps) {
  return (
    <ReportContentDialog
      isOpen={isOpen}
      onClose={onClose}
      subject="Message"
      description="Help us maintain a safe community by reporting inappropriate messages. All reports are reviewed and actioned within 24 hours."
      question="Why are you reporting this message?"
      reasons={REPORT_REASONS}
      radioIdPrefix="msg"
      detailsId="msg-details"
      invokeName="send-message-report-email"
      buildBody={(reason, additionalDetails) => ({
        messageId,
        messageType,
        reason,
        additionalDetails,
      })}
    />
  );
}
