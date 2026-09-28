import { useCallback, useRef } from "react";

const LONG_PRESS_DISMISS_GUARD_MS = 800;

type GuardableEvent = {
  preventDefault?: () => void;
  stopPropagation?: () => void;
};

const getNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function useLongPressDismissGuard() {
  const dismissGuardUntilRef = useRef(0);
  const ignoreContextMenuUntilRef = useRef(0);

  const armDismissGuard = useCallback(() => {
    const guardUntil = getNow() + LONG_PRESS_DISMISS_GUARD_MS;
    dismissGuardUntilRef.current = guardUntil;
    ignoreContextMenuUntilRef.current = guardUntil;
  }, []);

  const clearDismissGuard = useCallback(() => {
    dismissGuardUntilRef.current = 0;
    ignoreContextMenuUntilRef.current = 0;
  }, []);

  const isDismissGuardActive = useCallback(() => getNow() < dismissGuardUntilRef.current, []);

  const preventIfGuarded = useCallback((event?: GuardableEvent) => {
    if (!isDismissGuardActive()) {
      return false;
    }

    event?.preventDefault?.();
    event?.stopPropagation?.();
    return true;
  }, [isDismissGuardActive]);

  const consumeContextMenuGuard = useCallback(() => {
    const now = getNow();
    const shouldIgnore = now < ignoreContextMenuUntilRef.current;

    if (!shouldIgnore) {
      ignoreContextMenuUntilRef.current = 0;
      return false;
    }

    ignoreContextMenuUntilRef.current = 0;
    return true;
  }, []);

  return {
    armDismissGuard,
    clearDismissGuard,
    consumeContextMenuGuard,
    isDismissGuardActive,
    preventIfGuarded,
  };
}