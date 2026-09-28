import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { hapticSelectionTick } from "@/lib/haptics";

const HINT_STORAGE_KEY = "chat:send-long-press-hint:v1";
const SEND_COUNT_KEY = "chat:send-count";
const HINT_AFTER_SENDS = 3;
const LONG_PRESS_MS = 350;

interface ChatSendButtonProps {
  onSend: () => void;
  /** Called when the user long-presses (or right-clicks) the send button. */
  onSchedule?: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Set true when there's something to send — affects the "send count" tracking. */
  canSend?: boolean;
  className?: string;
  /** When true the explicit schedule icon is hidden (useful when the parent already shows one). */
  hideScheduleIcon?: boolean;
}

/**
 * Primary send button with a long-press / right-click affordance for opening
 * the schedule-message sheet. Shows a one-time discoverability hint after the
 * user has sent a few messages.
 */
export function ChatSendButton({
  onSend,
  onSchedule,
  disabled,
  loading,
  canSend = true,
  className,
}: ChatSendButtonProps) {
  const timerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  // Tracks whether the current gesture has already fired onSend, so the
  // follow-up synthetic click (after pointerup) doesn't double-send.
  const firedThisGestureRef = useRef(false);
  // Guards against accidental sends from swipe-type / gesture-typing where
  // the pointer ENDS on the send button but never began on it. Only a tap
  // that actually started on this button is allowed to fire.
  const pointerDownOnUsRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const [pressing, setPressing] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const cancelTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => cancelTimer(), []);

  const dismissHint = () => {
    setShowHint(false);
    try {
      localStorage.setItem(HINT_STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const maybeShowHint = () => {
    if (!onSchedule) return;
    try {
      if (localStorage.getItem(HINT_STORAGE_KEY)) return;
      const next = (parseInt(localStorage.getItem(SEND_COUNT_KEY) || "0", 10) || 0) + 1;
      localStorage.setItem(SEND_COUNT_KEY, String(next));
      if (next >= HINT_AFTER_SENDS) {
        setShowHint(true);
        window.setTimeout(() => dismissHint(), 6000);
      }
    } catch {
      /* ignore */
    }
  };

  const fireSend = () => {
    if (firedThisGestureRef.current) return;
    if (disabled || loading) return;
    firedThisGestureRef.current = true;
    // Fire a tiny selection-tick haptic synchronously inside the user gesture
    // (Light/Medium felt too heavy on send — Messenger/WhatsApp use a barely
    // perceptible tick). Stays inside the gesture so navigator.vibrate works.
    hapticSelectionTick();
    onSend();
    if (canSend) maybeShowHint();
    // Reset shortly after so subsequent gestures can fire.
    window.setTimeout(() => {
      firedThisGestureRef.current = false;
    }, 300);
  };

  const handleClick = () => {
    // Fallback for mouse/keyboard — pointerup path already fired on touch.
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    fireSend();
  };

  const startLongPress = (e: React.PointerEvent) => {
    // Never let the send button take focus away from the composer textarea.
    // Chrome/Android focuses <button> on tap; the resulting textarea blur
    // reaches the IME as a real keyboard hide, and our keyboard-height hooks
    // then collapse and restore the chat viewport — the post-send "thread
    // jumps up and back". Cancelling pointerdown (and the compat mousedown)
    // suppresses the focus change while click/pointerup still fire.
    e.preventDefault();
    longPressedRef.current = false;
    firedThisGestureRef.current = false;
    pointerDownOnUsRef.current = true;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    setPressing(true);
    cancelTimer();
    if (!onSchedule || disabled || loading) return;
    timerRef.current = window.setTimeout(() => {
      longPressedRef.current = true;
      setPressing(false);
      dismissHint();
      onSchedule();
    }, LONG_PRESS_MS);
  };

  // Fallback for browsers that still dispatch mousedown (focus happens on
  // mousedown's default action).
  const preventFocusSteal = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const endLongPress = (e?: React.PointerEvent) => {
    cancelTimer();
    setPressing(false);
    // Only fire on a clean tap that BEGAN on this button. This rejects
    // swipe-typing gestures that happen to end over the send icon — the
    // root cause of garbled messages like "wothpur" being sent mid-word.
    const startedOnUs = pointerDownOnUsRef.current;
    pointerDownOnUsRef.current = false;
    if (!e || e.type !== "pointerup") return;
    if (!startedOnUs) return;
    if (longPressedRef.current) return;
    // Reject if pointer drifted significantly (treat as swipe, not tap).
    const start = pointerDownPosRef.current;
    pointerDownPosRef.current = null;
    if (start) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy > 24 * 24) return;
    }
    fireSend();
  };


  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onSchedule) return;
    e.preventDefault();
    longPressedRef.current = true;
    dismissHint();
    onSchedule();
  };

  return (
    <div className="relative inline-flex items-center">
      {showHint && (
        <div
          className="absolute bottom-full right-0 mb-2 z-50 inline-flex items-center gap-1.5 rounded-md bg-foreground text-background text-[11px] font-medium px-2.5 py-1.5 shadow-lg whitespace-nowrap animate-in fade-in slide-in-from-bottom-1"
        >
          Hold send to schedule
        </div>
      )}
      <button
        type="button"
        data-chat-send-button="true"
        
        onClick={handleClick}
        onMouseDown={preventFocusSteal}
        onPointerDown={startLongPress}
        onPointerUp={endLongPress}
        onPointerLeave={() => endLongPress()}
        onPointerCancel={() => endLongPress()}
        onContextMenu={handleContextMenu}
        disabled={disabled || loading}
        aria-label={onSchedule ? "Send message (hold to schedule)" : "Send message"}
        title={onSchedule ? "Send · Hold to schedule" : "Send"}
        className={cn(
          // True 40×40 outer box to match + and emoji exactly. Avoid negative
          // margins here: flex bottom-alignment uses the margin box, which made
          // the paper-plane sit a few pixels low in the composer.
          "group relative flex h-10 w-10 items-center justify-center shrink-0 rounded-full bg-transparent select-none touch-none",
          className,
        )}
      >
        <span
          className={cn(
            "flex items-center justify-center rounded-full transition-all duration-200 ease-out",
            canSend
              ? "h-8 w-8 bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.15),0_2px_6px_-2px_hsl(var(--primary)/0.40)] scale-100 group-hover:bg-primary/95 group-active:bg-primary/90 group-active:scale-95"
              : "h-10 w-10 bg-transparent text-muted-foreground/85 shadow-none scale-100",
            pressing && canSend && "scale-110 ring-2 ring-primary/40 ring-offset-1 ring-offset-background",
          )}
        >
          {loading ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={2.4} />
          ) : (
            <Send
              className={cn(
                "transition-transform duration-150",
                canSend
                  ? "h-[18px] w-[18px] translate-x-[-0.5px]"
                  : "h-[22px] w-[22px] translate-y-[-0.5px]",
              )}
              strokeWidth={2.2}
            />
          )}
        </span>
      </button>
    </div>
  );
}
