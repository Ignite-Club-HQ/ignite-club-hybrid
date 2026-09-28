import type { ReactNode } from "react";
import { ChevronDown, HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CollapsibleTrigger } from "@/components/ui/collapsible";

interface VaultStorageBarRowProps {
  /** 0-100 fill for the storage progress bar. */
  storagePercentage: number;
  /** Human readable "1.2 GB / 5 GB" style label. */
  usageLabel: string;
  isStorageLimitReached?: boolean;
  /**
   * Action controls (e.g. the "More" dropdown trigger).
   * Rendered as a SIBLING of the collapsible trigger — never nested inside it,
   * so no <button> ever descends from another <button>.
   */
  actions?: ReactNode;
}

export function VaultStorageBarRow({
  storagePercentage,
  usageLabel,
  isStorageLimitReached = false,
  actions,
}: VaultStorageBarRowProps) {
  return (
    <div className="flex items-center gap-3">
      <CollapsibleTrigger
        className="group flex flex-1 min-w-0 items-center gap-3 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label="Toggle storage details"
      >
        <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <Progress
            value={storagePercentage}
            className={`h-2 w-full bg-white dark:bg-muted ${
              storagePercentage >= 90
                ? "[&>div]:bg-destructive"
                : storagePercentage >= 70
                  ? "[&>div]:bg-yellow-500"
                  : "[&>div]:bg-primary"
            }`}
          />
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{usageLabel}</span>
        {isStorageLimitReached && (
          <Badge variant="destructive" className="text-xs shrink-0">
            Full
          </Badge>
        )}
        <ChevronDown
          className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-data-[state=open]:rotate-180"
          aria-hidden="true"
        />
      </CollapsibleTrigger>

      {actions}
    </div>
  );
}
