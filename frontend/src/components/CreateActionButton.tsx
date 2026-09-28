import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface CreateActionButtonProps {
  onClick: () => void;
  ariaLabel: string;
  className?: string;
}

export function CreateActionButton({ onClick, ariaLabel, className }: CreateActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md hover:bg-primary/90 active:scale-95 transition-all touch-manipulation select-none cursor-pointer shrink-0",
        className
      )}
    >
      <Plus className="h-5 w-5" strokeWidth={2.5} />
    </button>
  );
}
