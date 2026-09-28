export const IOS_LAYOUT_RESET_EVENT = "ignite:ios-layout-reset";
export const IOS_NAV_GUARD_EVENT = "ignite:ios-nav-guard";

interface IOSNavGuardDetail {
  durationMs?: number;
  /** When true, BottomNav immediately resets inset to floor (post-permission-prompt recovery). */
  forceFloor?: boolean;
}

const canUseDOM = () => typeof window !== "undefined" && typeof document !== "undefined";

export const emitIOSLayoutReset = () => {
  if (!canUseDOM()) return;
  window.dispatchEvent(new CustomEvent(IOS_LAYOUT_RESET_EVENT));
};

export const emitIOSNavGuard = (durationMs = 900, options?: { forceFloor?: boolean }) => {
  if (!canUseDOM()) return;
  window.dispatchEvent(
    new CustomEvent<IOSNavGuardDetail>(IOS_NAV_GUARD_EVENT, {
      detail: { durationMs, forceFloor: options?.forceFloor },
    }),
  );
};

const readSafeAreaInsetPx = (edge: "top" | "bottom") => {
  if (!canUseDOM()) return 0;

  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.left = "0";
  probe.style[edge] = "0";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";

  if (edge === "top") {
    probe.style.paddingTop = "env(safe-area-inset-top, 0px)";
  } else {
    probe.style.paddingBottom = "env(safe-area-inset-bottom, 0px)";
  }

  document.body.appendChild(probe);
  const styles = window.getComputedStyle(probe);
  const envInset = Number.parseFloat(
    edge === "top" ? styles.paddingTop || "0" : styles.paddingBottom || "0",
  );
  probe.remove();

  const safeEnvInset = Number.isFinite(envInset) ? envInset : 0;

  if (edge === "top") {
    return safeEnvInset;
  }

  return safeEnvInset;
};

export const readSafeAreaInsetTopPx = () => readSafeAreaInsetPx("top");

export const readSafeAreaInsetBottomPx = () => readSafeAreaInsetPx("bottom");
