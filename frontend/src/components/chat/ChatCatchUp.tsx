import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
// CatchMeUpCard import removed — inline recap banner is no longer rendered.
import { CatchMeUpSheet } from "./CatchMeUpSheet";
import { AICatchUpDisclosureDialog } from "./AICatchUpDisclosureDialog";
import { useChatCatchUp, type ChatScopeType } from "@/hooks/useChatCatchUp";
import { useAICatchUpAvailability } from "@/hooks/useAICatchUpAvailability";
import { toast } from "sonner";

interface ChatCatchUpProps {
  scope_type: ChatScopeType;
  scope_id: string | null | undefined;
  unreadCount: number;
  latestMessageId?: string | null;
  proLocked?: boolean;
  upgradeHref?: string;
  registerTrigger?: (open: () => void) => void;
}

export function ChatCatchUp({
  scope_type,
  scope_id,
  unreadCount,
  latestMessageId = null,
  proLocked = false,
  upgradeHref,
  registerTrigger,
}: ChatCatchUpProps) {
  const navigate = useNavigate();
  const { clubDisabled, userDisabled, featureDisabled } = useAICatchUpAvailability(scope_type, scope_id);
  const [disclosureOpen, setDisclosureOpen] = useState(false);

  const {
    eligible, loading, error, result, sheetOpen, setSheetOpen,
    summarize, openSheet, dismissCard,
  } = useChatCatchUp({
    scope_type,
    scope_id,
    unreadCount,
    cardEnabled: !proLocked && !featureDisabled,
    latestMessageId,
  });

  // Surface the first-use disclosure modal when the edge function rejects with disclosure_required.
  useEffect(() => {
    if (error === "disclosure_required") {
      setSheetOpen(false);
      setDisclosureOpen(true);
    }
  }, [error, setSheetOpen]);

  useEffect(() => {
    if (!registerTrigger) return;
    registerTrigger(() => {
      if (proLocked) {
        toast.info("Chat Recap is a Pro feature");
        if (upgradeHref) navigate(upgradeHref);
        return;
      }
      if (clubDisabled) {
        toast.info("AI Chat Recap has been turned off for this club");
        return;
      }
      if (userDisabled) {
        toast.info("AI Chat Recap is turned off in your settings");
        return;
      }
      openSheet();
    });
  }, [registerTrigger, proLocked, clubDisabled, userDisabled, upgradeHref, navigate, openSheet]);

  if (!scope_id) return null;

  // Inline recap card removed — users trigger Chat Recap via the AI summary
  // icon in the chat header instead. We keep `eligible`/`dismissCard` wired
  // so the trigger registration above continues to work.
  void eligible;
  void dismissCard;

  return (
    <>

      <CatchMeUpSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        loading={loading}
        error={error}
        result={result}
        unreadCount={unreadCount}
        onRegenerate={() => void summarize({ force: true })}
        onLookback={(hours) => void summarize({ lookbackHours: hours })}
        onUpgrade={upgradeHref ? () => navigate(upgradeHref) : undefined}
      />

      <AICatchUpDisclosureDialog
        open={disclosureOpen}
        onOpenChange={setDisclosureOpen}
        onAcknowledged={() => {
          setSheetOpen(true);
          void summarize({ force: true });
        }}
      />
    </>
  );
}
