import { WifiOff, CloudOff, RefreshCw } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getQueueCount, syncQueuedMessages } from "@/lib/messageQueue";
import { getQueuedRsvpCount, syncQueuedRsvps } from "@/lib/rsvpQueue";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export function OfflineIndicator() {
  const { isOnline, wasOffline } = useOnlineStatus();
  const [queueCount, setQueueCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const queryClient = useQueryClient();

  // Update queue count periodically (combined messages + rsvps)
  useEffect(() => {
    const updateCount = () => setQueueCount(getQueueCount() + getQueuedRsvpCount());
    updateCount();
    const interval = setInterval(updateCount, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSync = useCallback(async () => {
    if (isSyncing || !isOnline) return;

    setIsSyncing(true);
    try {
      const [msgResult, rsvpResult] = await Promise.all([
        syncQueuedMessages(),
        syncQueuedRsvps(),
      ]);
      setQueueCount(getQueueCount() + getQueuedRsvpCount());

      const totalSynced = msgResult.synced + rsvpResult.synced;
      const totalFailed = msgResult.failed + rsvpResult.failed;

      if (totalSynced > 0) {
        toast.success(`Synced ${totalSynced} item${totalSynced > 1 ? "s" : ""}`);
        // Refresh affected queries
        if (rsvpResult.synced > 0) {
          queryClient.invalidateQueries({ queryKey: ["event-rsvps"] });
          queryClient.invalidateQueries({ queryKey: ["events"] });
        }
      }
      if (totalFailed > 0) {
        toast.error(`Failed to sync ${totalFailed} item${totalFailed > 1 ? "s" : ""}`);
      }
    } catch (error) {
      console.error("Sync failed:", error);
      toast.error("Failed to sync");
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, isSyncing, queryClient]);

  // Auto-sync when coming back online
  useEffect(() => {
    if (wasOffline && isOnline && queueCount > 0) {
      handleSync();
    }
  }, [wasOffline, isOnline, queueCount, handleSync]);

  // Don't show if online and no queued items
  if (isOnline && queueCount === 0) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2">
      <div
        className={`flex items-center gap-2 px-4 py-2 rounded-full shadow-lg ${
          isOnline
            ? "bg-amber-500/90 text-amber-50"
            : "bg-destructive/90 text-destructive-foreground"
        }`}
      >
        {!isOnline ? (
          <>
            <WifiOff className="h-4 w-4" />
            <span className="text-sm font-medium">
              Offline{queueCount > 0 ? ` • ${queueCount} pending` : ""}
            </span>
          </>
        ) : (
          <>
            <CloudOff className="h-4 w-4" />
            <span className="text-sm font-medium">{queueCount} pending</span>
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="ml-1 p-1 rounded-full hover:bg-white/20 transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
