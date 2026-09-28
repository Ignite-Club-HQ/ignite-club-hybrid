import { useSyncStatus, SyncStatus } from "@/hooks/useSyncStatus";
import { CloudOff, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

export function SyncStatusIndicator() {
  const { status, lastSyncTime } = useSyncStatus();
  // Tick once a second so a stale "syncing" status (e.g. left over in
  // localStorage from a previous session that crashed before resolving)
  // is reclassified as idle and the spinner disappears.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== "syncing") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status]);
  // If "syncing" has been showing for >5s without a lastSyncTime update,
  // treat it as stale and hide the indicator entirely.
  const syncAge = lastSyncTime ? now - lastSyncTime : Infinity;
  const effectiveStatus: SyncStatus =
    status === "syncing" && syncAge > 5000 ? "idle" : status;

  const getStatusConfig = (s: SyncStatus) => {
    switch (s) {
      case "syncing":
        return {
          icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
          label: "Syncing...",
          color: "text-blue-500",
        };
      case "synced":
        return {
          icon: <CheckCircle2 className="h-3.5 w-3.5" />,
          label: "Synced to server",
          color: "text-green-500",
        };
      case "error":
        return {
          icon: <AlertCircle className="h-3.5 w-3.5" />,
          label: "Sync failed",
          color: "text-destructive",
        };
      default:
        return {
          icon: <CloudOff className="h-3.5 w-3.5" />,
          label: "Not syncing",
          color: "text-muted-foreground",
        };
    }
  };

  const config = getStatusConfig(effectiveStatus);
  const timeAgo = lastSyncTime ? Math.floor((Date.now() - lastSyncTime) / 1000) : null;

  // Only show when actively syncing or has an error - hide the green tick when synced
  if (effectiveStatus === "idle" || effectiveStatus === "synced") return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-md bg-muted/50 text-xs",
            config.color
          )}>
            {config.icon}
            <span className="hidden sm:inline">{effectiveStatus === "syncing" ? "Syncing" : "Error"}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{config.label}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Background notifications enabled
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
