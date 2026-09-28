import { useState, useEffect, useCallback, useRef } from "react";
import { Smile, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { GifGrid } from "@/components/chat/GifGrid";
import { GifPickerMobileSheet } from "@/components/chat/GifPickerMobileSheet";

const RECENT_EMOJIS_KEY = "ignite-recent-emojis";
const MAX_RECENT_EMOJIS = 14;

const EMOJI_CATEGORIES = [
  {
    name: "Smileys",
    icon: "😊",
    emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🤧", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "🥸", "😎", "🤓", "🧐"],
  },
  {
    name: "Gestures",
    icon: "👋",
    emojis: ["👋", "🤚", "🖐", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "💪", "🦾"],
  },
  {
    name: "Hearts",
    icon: "❤️",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❤️‍🔥", "❤️‍🩹", "💖", "💗", "💓", "💞", "💕", "💟", "❣️", "💝"],
  },
  {
    name: "Sports",
    icon: "⚽",
    emojis: ["⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱", "🏓", "🏸", "🏒", "🏑", "🥍", "🏏", "🥅", "⛳", "🏹", "🎣", "🤿", "🥊", "🥋", "🎽", "🛹", "🛼", "🏋️", "🤺", "⛷️", "🏂", "🏌️", "🏇", "⛹️", "🏊", "🚴", "🚵", "🤸", "🤼", "🤽", "🤾", "🤹", "🧗", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "🏵️"],
  },
  {
    name: "Celebration",
    icon: "🎉",
    emojis: ["🎉", "🎊", "🎈", "🎁", "🎀", "🎂", "🍰", "🧁", "🥳", "🪅", "🎆", "🎇", "✨", "🎄", "🎃", "👻", "🎅", "🤶", "🧑‍🎄"],
  },
  {
    name: "Objects",
    icon: "🔥",
    emojis: ["🔥", "💯", "✅", "❌", "⭐", "🌟", "💫", "⚡", "💥", "💢", "💨", "💦", "💤", "🎵", "🎶", "🔔", "📣", "📢", "💬", "💭", "🗯️", "♠️", "♣️", "♥️", "♦️", "🃏", "🎴", "🎰"],
  },
];

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string) => void;
  /** Optional: if provided, a "GIF" tab is shown alongside emojis. */
  onGifSelect?: (gifUrl: string) => void;
  disabled?: boolean;
}

function getRecentEmojis(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_EMOJIS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentEmoji(emoji: string) {
  try {
    const recent = getRecentEmojis().filter(e => e !== emoji);
    recent.unshift(emoji);
    localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_EMOJIS)));
  } catch {
    // Ignore storage errors
  }
}

export function EmojiPicker({ onEmojiSelect, onGifSelect, disabled }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"emoji" | "gif">("emoji");
  const [gifSheetOpen, setGifSheetOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState(0);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const isMobile = useIsMobile();
  const isNative = Capacitor.isNativePlatform();
  const isNativeIOS = isNative && Capacitor.getPlatform() === "ios";
  const onEmojiSelectRef = useRef(onEmojiSelect);
  const onGifSelectRef = useRef(onGifSelect);
  const closingForMessageSendRef = useRef(false);
  const closeResetTimerRef = useRef<number | null>(null);
  const showGifTab = !!onGifSelect;
  // On mobile, GIFs render in a dedicated keyboard-aware bottom sheet instead
  // of inside the popover so the search input + results never get covered.
  const useGifSheet = isMobile && showGifTab;
  // The popover only needs the tall flex layout when GIFs render INSIDE it
  // (desktop with GIF tab). On mobile we use a dedicated sheet, so the popover
  // should size to its emoji content (with the grid scrolling internally).
  const useInlineGifLayout = showGifTab && !useGifSheet;

  const dismissIOSKeyboardAccessory = useCallback(() => {
    if (!isNativeIOS) return;

    (document.activeElement as HTMLElement | null)?.blur();
    requestAnimationFrame(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    setTimeout(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    }, 120);
  }, [isNativeIOS]);

  // Dismiss the soft keyboard before showing the picker on any native platform.
  // Android uses `Keyboard.resize: 'none'`, so the visible viewport doesn't
  // shrink when the keyboard is open — meaning the emoji popover would render
  // partially behind the keyboard. Hiding it guarantees a known-good layout.
  const dismissNativeKeyboard = useCallback(() => {
    if (!isNative) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.blur === "function") active.blur();
    try {
      Keyboard.hide().catch(() => {});
    } catch {
      // Plugin may be unavailable in some web contexts
    }
  }, [isNative]);

  // Keep refs updated
  useEffect(() => {
    onEmojiSelectRef.current = onEmojiSelect;
  }, [onEmojiSelect]);
  useEffect(() => {
    onGifSelectRef.current = onGifSelect;
  }, [onGifSelect]);

  useEffect(() => {
    if (open) {
      setRecentEmojis(getRecentEmojis());
    } else {
      // Reset to emoji tab on close so next open is predictable
      setTab("emoji");
    }
  }, [open]);

  // Close when the soft keyboard is dismissed while the picker is open.
  // The popover anchors to the trigger and won't reflow when the visual
  // viewport grows, so it would otherwise float mid-screen above an empty
  // gap where the keyboard used to be.
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    let lastH = vv.height;
    const onResize = () => {
      const h = vv.height;
      if (h - lastH > 120 && !closingForMessageSendRef.current) setOpen(false);
      lastH = h;
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [open]);

  // Close on message send so the popover doesn't re-position over an
  // updating message list.
  useEffect(() => {
    const close = () => {
      closingForMessageSendRef.current = true;
      if (closeResetTimerRef.current !== null) window.clearTimeout(closeResetTimerRef.current);
      setOpen(false);
      closeResetTimerRef.current = window.setTimeout(() => {
        closingForMessageSendRef.current = false;
        closeResetTimerRef.current = null;
      }, 500);
    };
    window.addEventListener("chat:message-sent", close);
    return () => {
      window.removeEventListener("chat:message-sent", close);
      if (closeResetTimerRef.current !== null) window.clearTimeout(closeResetTimerRef.current);
    };
  }, []);




  const handleEmojiClick = useCallback((emoji: string) => {
    // Keep the textarea focused so the native keyboard stays up — users
    // typically insert an emoji mid-sentence and want to keep typing.
    saveRecentEmoji(emoji);
    onEmojiSelectRef.current(emoji);
  }, []);

  const handleGifPick = useCallback((url: string) => {
    dismissIOSKeyboardAccessory();
    onGifSelectRef.current?.(url);
    requestAnimationFrame(() => {
      setOpen(false);
      setGifSheetOpen(false);
      dismissIOSKeyboardAccessory();
    });
  }, [dismissIOSKeyboardAccessory]);


  const createEmojiHandler = useCallback((emoji: string) => {
    return (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleEmojiClick(emoji);
    };
  }, [handleEmojiClick]);

  return (
    <>
    <Popover open={open} onOpenChange={(newOpen) => {
      // Intentionally do NOT blur the textarea / hide the native keyboard
      // here. Users expect to keep typing after inserting an emoji; dismissing
      // the keyboard forces an extra tap to resume typing. The composer is
      // already positioned above the keyboard via useNativeKeyboardBottomInset,
      // so the popover (side="top") renders above the composer + keyboard.
      //
      // IMPORTANT: ignore Radix-initiated CLOSE requests entirely. Every
      // legitimate close path is handled explicitly by us (trigger toggle,
      // onPointerDownOutside, Escape, GIF pick). Radix's dismissable layer
      // has additional internal close triggers (focus/blur races while
      // typing in the GIF search input, visual-viewport shifts, etc.) that
      // were dismissing the picker mid-interaction.
      if (newOpen) setOpen(true);
    }}>


      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Insert emoji"
          title="Insert emoji"
          aria-haspopup="dialog"
          aria-expanded={open}
          data-emoji-button
          onPointerDown={(e) => {
            // Toggle immediately on pointerdown so fast taps register reliably.
            // Radix's default click-based trigger can lose fast taps when the
            // dismissable layer races the pointerup event.
            if (disabled) return;
            setOpen((prev) => !prev);
            // Prevent the default focus shift so the popover doesn't
            // immediately receive then drop focus on touch — and so the
            // textarea retains focus and the native keyboard stays open.
            e.preventDefault();
          }}

          onClick={(e) => {
            // Click is redundant with pointerdown above; swallow it so Radix
            // doesn't toggle the popover closed right after we opened it.
            e.preventDefault();
            e.stopPropagation();
          }}
          className="h-10 w-10 shrink-0 rounded-full text-foreground/60 hover:text-foreground hover:bg-muted/60 active:bg-muted/70 active:scale-95 transition-all duration-100 disabled:opacity-40 disabled:active:scale-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background touch-manipulation flex items-center justify-center"
          disabled={disabled}
        >
          <Smile className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={`p-2 ${isMobile ? "!w-[calc(100vw-1rem)] !max-w-none" : "w-72"} ${useInlineGifLayout ? "h-[360px] flex flex-col" : ""}`}
        side="top"
        align={isMobile ? "center" : "start"}
        sideOffset={8}
        collisionPadding={8}
        avoidCollisions={true}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={() => setOpen(false)}

        onFocusOutside={(e) => {
          // Never close on focus changes. Tapping the GIF search input (or any
          // interactive child) blurs the composer textarea, which can briefly
          // move focus to <body> before landing on the new target — that
          // intermediate focus would otherwise fall through Radix's default
          // and dismiss the popover.
          e.preventDefault();
        }}
        onInteractOutside={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest('[data-gif-picker]')) {
            e.preventDefault();
          }
        }}
        onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('[data-gif-picker]')) {
            e.preventDefault();
            return;
          }
          if (target.closest('[data-chat-send-button]')) {
            e.preventDefault();
            return;
          }
          if (!target.closest('[data-emoji-button]')) {
            setOpen(false);
          }
        }}
      >
        {/* Tab switcher (only when GIFs are enabled) */}
        {showGifTab && (
          <div className="flex gap-1 mb-2 p-0.5 rounded-md bg-muted/60">
            <button
              type="button"
              data-emoji-button
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTab("emoji");
              }}
              className={`flex-1 rounded text-xs font-medium py-1.5 transition-colors ${
                tab === "emoji"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Emoji
            </button>
            <button
              type="button"
              data-emoji-button
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (useGifSheet) {
                  // Open the dedicated mobile sheet and close the popover
                  dismissIOSKeyboardAccessory();
                  dismissNativeKeyboard();
                  setGifSheetOpen(true);
                  setOpen(false);
                } else {
                  setTab("gif");
                }
              }}
              className={`flex-1 rounded text-xs font-semibold py-1.5 transition-colors ${
                tab === "gif"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              GIF
            </button>
          </div>
        )}

        {tab === "emoji" || !showGifTab || useGifSheet ? (
          <div className={useInlineGifLayout ? "flex-1 min-h-0 flex flex-col overflow-hidden" : ""}>
            {/* Recent emojis row */}
            {recentEmojis.length > 0 && (
              <div className="mb-2 pb-2 border-b shrink-0">
                <div className="flex items-center gap-1 mb-1">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Recent</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {recentEmojis.map((emoji, idx) => (
                    <button
                      type="button"
                      key={`recent-${emoji}-${idx}`}
                      data-emoji-button
                      onClick={createEmojiHandler(emoji)}
                      onTouchEnd={createEmojiHandler(emoji)}
                      className={`flex items-center justify-center hover:bg-accent active:bg-accent rounded transition-colors cursor-pointer select-none touch-manipulation ${
                        isMobile ? "h-9 w-9 text-xl" : "h-7 w-7 text-base"
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Category tabs */}
            <div className="flex gap-1 mb-2 pb-1 border-b overflow-x-auto scrollbar-hide shrink-0">
              {EMOJI_CATEGORIES.map((cat, idx) => (
                <button
                  type="button"
                  key={cat.name}
                  data-emoji-button
                  onMouseDown={(e) => {
                    // Don't steal focus from the composer/popover — focus
                    // transfer can race with Radix's dismissable layer and
                    // tear down the popover before the click registers.
                    e.preventDefault();
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setActiveCategory(idx);
                  }}
                  className={`shrink-0 rounded transition-colors ${
                    isMobile
                      ? "h-8 w-8 flex items-center justify-center text-lg"
                      : "px-2 py-1 text-xs whitespace-nowrap"
                  } ${
                    activeCategory === idx
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent text-muted-foreground"
                  }`}
                  title={cat.name}
                >
                  {isMobile ? cat.icon : cat.name}
                </button>
              ))}
            </div>

            {/* Emoji grid */}
            <div className={`grid gap-1 ${useInlineGifLayout ? "flex-1 min-h-0" : "max-h-52"} overflow-y-auto ${
              isMobile ? "grid-cols-7" : "grid-cols-8"
            }`}>
              {EMOJI_CATEGORIES[activeCategory].emojis.map((emoji) => (
                <button
                  type="button"
                  key={emoji}
                  data-emoji-button
                  onClick={createEmojiHandler(emoji)}
                  onTouchEnd={createEmojiHandler(emoji)}
                  className={`flex items-center justify-center hover:bg-accent active:bg-accent rounded transition-colors select-none touch-manipulation ${
                    isMobile ? "h-10 w-10 text-xl" : "h-8 w-8 text-lg"
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <GifGrid
            active={tab === "gif"}
            onSelect={handleGifPick}
            scrollClassName="flex-1 min-h-0"
            gridClassName="grid-cols-2"
            className="flex-1 min-h-0"
          />
        )}
      </PopoverContent>
    </Popover>

    {/* Mobile-only keyboard-aware GIF sheet */}
    {useGifSheet && (
      <GifPickerMobileSheet
        open={gifSheetOpen}
        onClose={() => setGifSheetOpen(false)}
        onSelect={handleGifPick}
      />
    )}
    </>
  );
}
