import { useEffect, useState } from "react";
import { FeedbackDialog } from "./FeedbackDialog";
import { GAP_REPORT_EVENT, takeGapReport } from "@/lib/gapFeedback";

export default function IcpGapFeedback() {
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  useEffect(() => {
    const open = () => { const next = takeGapReport(); if (next) setDiagnostic(next); };
    window.addEventListener(GAP_REPORT_EVENT, open);
    open();
    return () => window.removeEventListener(GAP_REPORT_EVENT, open);
  }, []);
  return <FeedbackDialog open={diagnostic !== null} onOpenChange={open => { if (!open) setDiagnostic(null); }} gapDiagnostic={diagnostic ?? undefined} />;
}