import { useState, useEffect } from "react";
import { Reply, Pencil, Trash2, Flag, ShieldAlert, MoreHorizontal, ChevronLeft, Copy, Link, ExternalLink, ImageIcon, Check, Pin, PinOff, ImagePlus, Loader2, Forward } from "lucide-react";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { stripMentionFormatting } from "@/lib/messagePreview";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

interface MessageAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}

// Extract plain URLs from message text, including bare domains like example.com
const extractUrls = (text: string): string[] => {
  const urlRegex = /(?:https?:\/\/|www\.)[^\s\]]+/gi;
  const bareDomainRegex = /(?:^|[\s([{<])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|edu|gov|au|co|io|app|dev|club|team|sport|sports|com\.au|org\.au|net\.au)(?::\d{2,5})?(?:\/[^\s\])}>,]*)?)/gi;
  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const urls: string[] = [];
  const addUrl = (url: string) => {
    const normalized = url.replace(/[.,!?;:]+$/g, "");
    if (normalized && !urls.includes(normalized)) urls.push(normalized);
  };

  let match;
  while ((match = markdownLinkRegex.exec(text)) !== null) {
    addUrl(match[2]);
  }
  while ((match = urlRegex.exec(text)) !== null) {
    addUrl(match[0]);
  }
  while ((match = bareDomainRegex.exec(text)) !== null) {
    addUrl(match[1]);
  }
  return urls;
};

interface MessageActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOwn: boolean;
  isAdmin?: boolean;
  canReply: boolean;
  canEdit: boolean;
  canDelete: boolean;
  isSystemMessage?: boolean;
  messageText?: string;
  hasImage?: boolean;
  onReply: () => void;
  /** Optional. When provided, a "Forward" action appears in the More menu. */
  canForward?: boolean;
  onForward?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReport: () => void;
  onBlock: () => void;
  onViewImage?: () => void;
  // Pin support (only set for chats that support pinning)
  canPin?: boolean;
  isPinned?: boolean;
  pinLimitReached?: boolean;
  onPin?: () => void;
  onUnpin?: () => void;
  // Publish-to-gallery support
  canPublishToGallery?: boolean;
  isPublishedToGallery?: boolean;
  isPublishingToGallery?: boolean;
  onPublishToGallery?: () => void;
  /** Optional quick-reaction row above the sheet. */
  onReact?: (emoji: string) => void;
}

// Reactions intentionally live in the floating pill above the bubble, not in
// this sheet. See MessageReactionsPopover for the quick-reaction emoji set.

export function MessageActionSheet({
  open,
  onOpenChange,
  isOwn,
  canReply,
  canEdit,
  canDelete,
  isSystemMessage,
  messageText,
  hasImage,
  onReply,
  canForward = false,
  onForward,
  onEdit,
  onDelete,
  onReport,
  onBlock,
  onViewImage,
  canPin = false,
  isPinned = false,
  pinLimitReached = false,
  onPin,
  onUnpin,
  canPublishToGallery = false,
  isPublishedToGallery = false,
  isPublishingToGallery = false,
  onPublishToGallery,
  onReact,
}: MessageActionSheetProps) {
  const [showMore, setShowMore] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  useEffect(() => {
    if (copiedText) {
      const timer = setTimeout(() => setCopiedText(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [copiedText]);

  // Reset submenu state whenever sheet closes
  useEffect(() => {
    if (!open) setShowMore(false);
  }, [open]);

  // While the action sheet is open, the user is in "message action mode",
  // not "composition mode". Broadcast open state so the composer can dim and
  // become non-interactive, and dismiss the soft keyboard if focused.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("chat-action-sheet:toggle", { detail: { open } }));
    if (open) {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
        active.blur();
      }
    }
    return () => {
      if (open) {
        window.dispatchEvent(new CustomEvent("chat-action-sheet:toggle", { detail: { open: false } }));
      }
    };
  }, [open]);

  // ---------- Primary actions (kept intentionally short) ----------
  // Only Reply lives in the top-level sheet — everything else (Copy, Forward,
  // Pin, etc.) is one tap away behind "More…". This keeps the most common
  // action visually dominant and reduces cognitive load on open.
  const primary: MessageAction[] = [];

  if (canReply) {
    primary.push({
      id: "reply",
      label: "Reply",
      icon: <Reply className="h-[20px] w-[20px]" />,
      onClick: onReply,
    });
  }

  if (canEdit) {
    primary.push({
      id: "edit",
      label: "Edit",
      icon: <Pencil className="h-[18px] w-[18px]" />,
      onClick: onEdit,
    });
  }


  // ---------- Secondary actions (everything else lives behind More…) ----------
  const secondary: MessageAction[] = [];

  // Copy is the most common secondary action — keep it first inside More…
  if (messageText) {
    const cleanMessageText = stripMentionFormatting(messageText);
    const isMessageCopied = copiedText === cleanMessageText;
    secondary.push({
      id: "copy-message",
      label: isMessageCopied ? "Copied!" : "Copy",
      icon: isMessageCopied
        ? <Check className="h-[18px] w-[18px] text-primary" />
        : <Copy className="h-[18px] w-[18px]" />,
      onClick: () => {
        navigator.clipboard.writeText(cleanMessageText).then(() => {
          setCopiedText(cleanMessageText);
        }).catch(() => {
          setCopiedText(null);
        });
      },
    });
  }


  if (hasImage && onViewImage) {
    secondary.push({
      id: "view-image",
      label: "View Image",
      icon: <ImageIcon className="h-[18px] w-[18px]" />,
      onClick: onViewImage,
    });
  }

  if (canForward && onForward) {
    secondary.push({
      id: "forward",
      label: "Forward",
      icon: <Forward className="h-[18px] w-[18px]" />,
      onClick: onForward,
    });
  }

  // Link actions extracted from text
  if (messageText) {
    const urls = extractUrls(messageText);
    if (urls.length > 0) {
      const firstUrl = urls[0];
      const isLinkCopied = copiedText === firstUrl;
      secondary.push({
        id: "open-link",
        label: "Open Link",
        icon: <ExternalLink className="h-[18px] w-[18px]" />,
        onClick: () => {
          const fullUrl = firstUrl.startsWith("http") ? firstUrl : `https://${firstUrl}`;
          safeOpenUrl(fullUrl);
        },
      });
      secondary.push({
        id: "copy-link",
        label: isLinkCopied ? "Link Copied!" : "Copy Link",
        icon: isLinkCopied
          ? <Check className="h-[18px] w-[18px] text-primary" />
          : <Link className="h-[18px] w-[18px]" />,
        onClick: () => {
          navigator.clipboard.writeText(firstUrl).then(() => {
            setCopiedText(firstUrl);
          }).catch(() => {
            setCopiedText(null);
          });
        },
      });
    }
  }

  // Pin / Unpin — admin/moderation-flavoured, lives in More
  if (canPin) {
    if (isPinned && onUnpin) {
      secondary.push({
        id: "unpin",
        label: "Unpin Message",
        icon: <PinOff className="h-[18px] w-[18px]" />,
        onClick: onUnpin,
      });
    } else if (!isPinned && onPin) {
      secondary.push({
        id: "pin",
        label: pinLimitReached ? "Pin (limit reached)" : "Pin Message",
        icon: <Pin className="h-[18px] w-[18px]" />,
        onClick: onPin,
      });
    }
  }

  // Publish to media gallery
  if (canPublishToGallery && hasImage && onPublishToGallery) {
    const label = isPublishingToGallery
      ? "Publishing…"
      : isPublishedToGallery
        ? "Published to Gallery"
        : "Publish to Gallery";
    secondary.push({
      id: "publish-gallery",
      label,
      icon: isPublishingToGallery
        ? <Loader2 className="h-[18px] w-[18px] animate-spin" />
        : isPublishedToGallery
          ? <Check className="h-[18px] w-[18px] text-primary" />
          : <ImagePlus className="h-[18px] w-[18px]" />,
      onClick: () => {
        if (isPublishingToGallery || isPublishedToGallery) return;
        onPublishToGallery();
      },
    });
  }

  if (canDelete) {
    secondary.push({
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="h-[18px] w-[18px]" />,
      onClick: onDelete,
      destructive: true,
    });
  }

  // Safety actions (Report / Block) — others' messages only
  const hasSafetyActions = !isOwn && !isSystemMessage;
  if (hasSafetyActions) {
    secondary.push({
      id: "report",
      label: "Report Message",
      icon: <Flag className="h-[18px] w-[18px]" />,
      onClick: onReport,
      destructive: true,
    });
    secondary.push({
      id: "block",
      label: "Block User",
      icon: <ShieldAlert className="h-[18px] w-[18px]" />,
      onClick: onBlock,
      destructive: true,
    });
  }

  const hasMore = secondary.length > 0;

  if (primary.length === 0 && !hasMore) return null;

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) setShowMore(false);
    onOpenChange(isOpen);
  };

  const renderAction = (action: MessageAction) => {
    const isReply = action.id === "reply";
    return (
      <button
        key={action.id}
        className={`w-full flex items-center gap-3 px-4 h-11 text-left text-[15px] transition-colors active:bg-muted ${
          isReply
            ? "font-semibold text-foreground [&>svg]:text-primary"
            : `font-medium ${action.destructive ? "text-destructive" : "text-foreground"}`
        }`}
        onClick={() => {
          handleOpenChange(false);
          requestAnimationFrame(() => action.onClick());
        }}
      >
        {action.icon}
        {action.label}
      </button>
    );
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        hideOverlay
        enableDragToClose
        // Anchored to the bottom edge. The sheet sizes only to its content
        // (Reply + More…) so there is no large empty gap between the selected
        // message and the action panel. Reactions live in the floating pill
        // above the bubble — see MessageReactionsPopover.
        className="px-0 pt-1 pb-[max(env(safe-area-inset-bottom,0px),8px)] rounded-t-[20px] bg-card dark:bg-[hsl(var(--card))] border-t border-border/40 shadow-[0_-12px_28px_-14px_rgba(0,0,0,0.45)] !duration-200 ease-out"
        style={{ zIndex: 100002 }}
      >
        <SheetTitle className="sr-only">Message Actions</SheetTitle>
        <SheetDescription className="sr-only">
          Choose an available action for this message.
        </SheetDescription>

        <div className="py-0">

          {!showMore ? (
            <>
              {primary.map(renderAction)}
              {hasMore && (
                <button
                  className="w-full flex items-center gap-3 px-4 h-11 text-left text-[15px] font-medium text-muted-foreground active:bg-muted transition-colors"
                  onClick={() => setShowMore(true)}
                >
                  <MoreHorizontal className="h-[18px] w-[18px]" />
                  More…
                </button>
              )}
            </>
          ) : (
            <>
              <button
                className="w-full flex items-center gap-3 px-4 h-11 text-left text-[15px] font-medium text-muted-foreground active:bg-muted transition-colors"
                onClick={() => setShowMore(false)}
              >
                <ChevronLeft className="h-[18px] w-[18px]" />
                Back
              </button>
              <div className="mx-4 border-t border-border/30" />
              {secondary.map(renderAction)}
            </>
          )}

          {copiedText && (
            <div className="mx-5 mt-1.5 mb-1.5 p-2 rounded-lg bg-primary/10 border border-primary/20">
              <p className="text-[11px] text-muted-foreground mb-0.5">Copied to clipboard:</p>
              <p className="text-sm text-foreground truncate">{copiedText}</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
