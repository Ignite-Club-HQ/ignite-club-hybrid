import { Check, ArrowUpRight, X } from "lucide-react";
import { toast } from "sonner";

interface DownloadSuccessToastProps {
  toastId: string | number;
  title: string;
  description: string;
  onOpen: () => void;
}

export function DownloadSuccessToast({ toastId, title, description, onOpen }: DownloadSuccessToastProps) {
  return (
    <div
      className="pointer-events-auto w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-border/60 bg-card text-card-foreground shadow-[0_8px_30px_-8px_hsl(var(--foreground)/0.25)] overflow-hidden"
      role="status"
    >
      <div className="flex items-stretch">
        <div className="flex items-center pl-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/25">
            <Check className="h-[18px] w-[18px]" strokeWidth={2.75} />
          </div>
        </div>

        <div className="flex-1 min-w-0 px-3 py-3">
          <div className="text-[14px] font-semibold leading-tight tracking-[-0.01em] truncate">
            {title}
          </div>
          <div className="text-[12.5px] text-muted-foreground leading-tight mt-0.5 truncate">
            {description}
          </div>
        </div>

        <div className="flex items-center gap-1 pr-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="inline-flex items-center gap-1 h-9 px-3.5 rounded-full bg-foreground text-background text-[13px] font-semibold tracking-[-0.005em] active:scale-[0.97] transition-transform touch-manipulation"
          >
            Open
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toast.dismiss(toastId);
            }}
            aria-label="Dismiss"
            className="inline-flex items-center justify-center h-8 w-8 rounded-full text-muted-foreground hover:bg-muted/60 active:bg-muted touch-manipulation"
          >
            <X className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </div>
  );
}
