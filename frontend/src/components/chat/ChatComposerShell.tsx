import { ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface ChatComposerShellProps {
  children: ReactNode;
  className?: string;
  /** Optional preview row (e.g. attached poll) rendered inside the composer pill, above the input row. */
  preview?: ReactNode;
}

/**
 * Unified composer container styled like WhatsApp / iMessage.
 *
 * While the message action sheet is open we listen for the
 * `chat-action-sheet:toggle` event and fade the composer out + disable
 * interaction so the user's focus stays on the selected message + actions.
 */
export function ChatComposerShell({ children, className, preview }: ChatComposerShellProps) {
  const [actionSheetOpen, setActionSheetOpen] = useState(false);

  useEffect(() => {
    const onToggle = (e: Event) => {
      const detail = (e as CustomEvent<{ open: boolean }>).detail;
      setActionSheetOpen(Boolean(detail?.open));
    };
    window.addEventListener("chat-action-sheet:toggle", onToggle as EventListener);
    return () => window.removeEventListener("chat-action-sheet:toggle", onToggle as EventListener);
  }, []);

  return (
    <div
      className={cn(
        "px-1 pt-2 pb-4 bg-background",
        "shadow-[0_-1px_0_0_hsl(var(--border)/0.25)]",
        "dark:shadow-[0_-1px_0_0_hsl(var(--border)/0.4)]",
        "transition-opacity duration-150",
        actionSheetOpen && "opacity-25 pointer-events-none",
      )}
      aria-hidden={actionSheetOpen || undefined}
    >
      <div
        className={cn(
          "w-full max-w-full min-w-0 overflow-visible",
          "rounded-[26px] bg-muted dark:bg-muted/60",
          "transition-[background-color] duration-150",
          "focus-within:bg-muted/90 dark:focus-within:bg-muted/75",
          className,
        )}
      >
        {preview && (
          <div className="px-1.5 pt-1.5">
            {preview}
          </div>
        )}
        <div className="flex w-full max-w-full min-w-0 items-end gap-0 overflow-visible pl-0.5 pr-1.5 py-1 min-h-[44px]">
          {children}
        </div>
      </div>
    </div>
  );
}
