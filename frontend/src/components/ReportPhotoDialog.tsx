import { ReportContentDialog, type ReportReason } from "@/components/reporting/ReportContentDialog";

interface ReportPhotoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  photoId: string;
}

const REPORT_REASONS: readonly ReportReason[] = [
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "offensive", label: "Offensive or harmful" },
  { value: "privacy", label: "Privacy concern" },
  { value: "copyright", label: "Copyright violation" },
  { value: "spam", label: "Spam or misleading" },
  { value: "other", label: "Other" },
];

export function ReportPhotoDialog({ isOpen, onClose, photoId }: ReportPhotoDialogProps) {
  return (
    <ReportContentDialog
      isOpen={isOpen}
      onClose={onClose}
      subject="Photo"
      description="Help us maintain a safe community by reporting inappropriate content. All reports are reviewed and actioned within 24 hours."
      question="Why are you reporting this photo?"
      reasons={REPORT_REASONS}
      radioIdPrefix="photo"
      detailsId="details"
      invokeName="send-photo-report-email"
      buildBody={(reason, additionalDetails) => ({
        photoId,
        reason,
        additionalDetails,
      })}
    />
  );
}
