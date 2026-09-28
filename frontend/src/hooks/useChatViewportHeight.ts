import { Capacitor } from "@capacitor/core";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";

const isNative = Capacitor.isNativePlatform();
const isNativeIOS = isNative && Capacitor.getPlatform() === "ios";
const isNativeAndroid = isNative && Capacitor.getPlatform() === "android";

/**
 * Returns the chat shell height relative to AppLayout's `<main>` area.
 *
 * AppHeader is already outside `<main>` in the flex layout, so chat pages must
 * NOT subtract the header from the viewport again. Doing so with an approximate
 * `4rem` header value was fragile once safe-area padding and mobile keyboard
 * viewport panning entered the picture: the explicit chat height could exceed
 * its real parent and let the outer app scroll/pan, hiding both AppHeader and
 * ChatHeaderShell. Keep this parent-relative and only subtract bottom chrome
 * that overlays `<main>`: the fixed bottom nav when closed, and the native
 * keyboard when it overlays instead of resizing the viewport.
 *
 * - Web: rely on 100dvh
 * - Native Android: use stable viewport height minus native keyboard height
 *   (Capacitor Keyboard.resize is set to 'none' so 100vh does NOT shrink)
 * - Native iOS: use stable viewport height minus native keyboard height
 */
export function useChatViewportHeight() {
  const nativeKeyboardHeight = useNativeKeyboardHeight();
  const isKeyboardOpen = useKeyboardOpen();

  // When keyboard is open on native, bottom nav is covered by keyboard,
  // so we don't need to subtract it. On web or when keyboard is closed,
  // subtract the bottom nav offset.
  const bottomNavOffset = isNative
    ? (isKeyboardOpen ? "0px" : "var(--bottom-nav-offset, 4rem)")
    : "var(--bottom-nav-offset, 4rem)";

  if (!isNative) {
    return `calc(100% - ${bottomNavOffset})`;
  }

  if (isNativeAndroid) {
    if (nativeKeyboardHeight > 0) {
      return `calc(100% - ${nativeKeyboardHeight}px)`;
    }
    return `calc(100% - ${bottomNavOffset})`;
  }

  if (isNativeIOS) {
    if (nativeKeyboardHeight > 0) {
      return `calc(100% - ${nativeKeyboardHeight}px)`;
    }
    return `calc(100% - ${bottomNavOffset})`;
  }

  return `calc(100% - ${bottomNavOffset})`;
}
