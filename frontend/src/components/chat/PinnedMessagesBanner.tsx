import { useState } from "react";
import { Pin, ChevronDown, X, ImageIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { hapticSelectionTick } from "@/lib/haptics";
import type { PinnedMessageWithContent } from "@/hooks/usePinnedMessages";


interface PinnedMessagesBannerProps {
  pins: PinnedMessageWithContent[];
  onJumpToMessage: (messageId: string) => void;
  onUnpin?: (messageId: string) => void;
}

const previewText = (pin: PinnedMessageWithContent) => {
  if (pin.text && pin.text.trim()) return pin.text;
  if (pin.image_url) return "📷 Photo";
  return "(empty message)";
};

export function PinnedMessagesBanner({
  pins,
  onJumpToMessage,
  onUnpin,
}: PinnedMessagesBannerProps) {
  const [listOpen, setListOpen] = useState(false);
  const [confirmPin, setConfirmPin] = useState<PinnedMessageWithContent | null>(null);


  if (pins.length === 0) return null;

  const latest = pins[0];
  const hasMore = pins.length > 1;

  const handleBannerClick = () => {
    hapticSelectionTick();
    if (hasMore) {
      setListOpen(true);
    } else {
      onJumpToMessage(latest.message_id);
    }
  };

  return (
    <>
      <div className="w-full flex items-center gap-3 px-4 py-2.5 bg-primary/5 border-b border-primary/20">
        <button
          type="button"
          onClick={handleBannerClick}
          className="flex-1 min-w-0 flex items-center gap-3 hover:bg-primary/10 active:bg-primary/15 transition-colors text-left -mx-2 px-2 py-1 rounded"
          aria-label={hasMore ? `View ${pins.length} pinned messages` : "Jump to pinned message"}
        >
          <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center">
            <Pin className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-primary uppercase tracking-wide">
                Pinned{hasMore ? ` · ${pins.length}` : ""}
              </span>
              <span className="text-[11px] text-muted-foreground truncate">
                {latest.author_name ?? "Member"}
              </span>
            </div>
            <p className="text-sm text-foreground truncate leading-tight mt-0.5">
              {previewText(latest)}
            </p>
          </div>
          {hasMore && (
            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )}
        </button>
        {onUnpin && !hasMore && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              hapticSelectionTick();
              setConfirmPin(latest);
            }}
            className="flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Unpin message"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <Sheet open={listOpen} onOpenChange={setListOpen}>
        <SheetContent
          side="bottom"
          className="px-0 pb-0 rounded-t-2xl max-h-[70vh] flex flex-col"
          style={{ zIndex: 100001 }}
        >
          <SheetHeader className="px-6 pb-3 border-b">
            <SheetTitle className="flex items-center gap-2 text-left">
              <Pin className="h-4 w-4 text-primary" />
              Pinned messages ({pins.length})
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1">
            <ul className="divide-y divide-border">
              {pins.map((pin) => (
                <li key={pin.id}>
                  <div className="flex items-start gap-3 px-6 py-3.5">
                    <button
                      type="button"
                      className="flex-1 min-w-0 flex items-start gap-3 text-left"
                      onClick={() => {
                        hapticSelectionTick();
                        setListOpen(false);
                        // Allow sheet close animation to start before jumping
                        requestAnimationFrame(() => onJumpToMessage(pin.message_id));
                      }}
                    >
                      <Avatar className="h-8 w-8 flex-shrink-0">
                        <AvatarImage src={pin.author_avatar ?? undefined} />
                        <AvatarFallback className="text-[11px]">
                          {(pin.author_name ?? "?").charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {pin.author_name ?? "Member"}
                        </p>
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                          {pin.image_url && !pin.text?.trim() ? (
                            <span className="inline-flex items-center gap-1">
                              <ImageIcon className="h-3.5 w-3.5" />
                              Photo
                            </span>
                          ) : (
                            previewText(pin)
                          )}
                        </p>
                      </div>
                    </button>
                    {onUnpin && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmPin(pin);
                        }}
                        className="flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        aria-label="Unpin message"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirmPin} onOpenChange={(o) => { if (!o) setConfirmPin(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpin this message?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmPin ? `"${previewText(confirmPin).slice(0, 120)}"` : ""} will no longer be pinned in this chat.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmPin) onUnpin?.(confirmPin.message_id);
                setConfirmPin(null);
              }}
            >
              Unpin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>

  );
}
