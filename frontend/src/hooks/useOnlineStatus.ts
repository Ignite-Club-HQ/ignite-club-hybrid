import { useEffect, useRef, useState } from "react";
import { onlineManager } from "@tanstack/react-query";

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => onlineManager.isOnline());
  const [wasOffline, setWasOffline] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const syncOnlineState = () => {
      const nextOnline = onlineManager.isOnline();

      setIsOnline((prevOnline) => {
        if (nextOnline && !prevOnline) {
          setWasOffline(true);
          if (resetTimerRef.current) {
            window.clearTimeout(resetTimerRef.current);
          }
          resetTimerRef.current = window.setTimeout(() => {
            setWasOffline(false);
            resetTimerRef.current = null;
          }, 5000);
        }

        return nextOnline;
      });
    };

    syncOnlineState();
    const unsubscribe = onlineManager.subscribe(syncOnlineState);

    return () => {
      unsubscribe();
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  return { isOnline, wasOffline };
}
