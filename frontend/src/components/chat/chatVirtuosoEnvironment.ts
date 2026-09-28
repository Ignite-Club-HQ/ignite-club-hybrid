type CapacitorLike = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

type AndroidEnvironment = {
  capacitor?: CapacitorLike | null;
  userAgent?: string;
};

export function isAndroidNativeWebView(environment?: AndroidEnvironment) {
  if (!environment && (typeof window === "undefined" || typeof navigator === "undefined")) return false;
  const runtimeWindow = typeof window === "undefined"
    ? undefined
    : window as Window & { Capacitor?: CapacitorLike };
  const capacitor = environment?.capacitor ?? runtimeWindow?.Capacitor;
  try {
    if (capacitor?.isNativePlatform?.() && capacitor.getPlatform?.() === "android") return true;
  } catch {
    // Fall through to the user-agent signal when the native bridge is waking.
  }
  const userAgent = environment?.userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent || "");
  return /Android/i.test(userAgent)
    && (/(; wv\)|\bwv\b)/i.test(userAgent) || /IgniteClubHQ-Android/i.test(userAgent));
}

export function escapeChatCssAttributeValue(
  value: string,
  nativeEscape: ((input: string) => string) | null =
    typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape.bind(CSS) : null,
) {
  if (nativeEscape) return nativeEscape(value);
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function handleVirtuosoResizeObserverError(event: ErrorEvent) {
  const message = typeof event.message === "string" ? event.message : "";
  if (!message.includes("ResizeObserver loop")) return false;
  event.stopImmediatePropagation();
  event.preventDefault();
  return true;
}

export function installVirtuosoResizeObserverErrorGuard(target?: Window) {
  const runtimeWindow = target ?? (typeof window === "undefined" ? undefined : window);
  if (!runtimeWindow) return;
  runtimeWindow.addEventListener("error", handleVirtuosoResizeObserverError, true);
}
