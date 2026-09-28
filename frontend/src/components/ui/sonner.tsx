import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";
import { Capacitor } from "@capacitor/core";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Sonner wrapper that PORTALS the toaster directly to `document.body`.
 *
 * Why a portal: Sonner renders a `<section data-sonner-toaster>` inline in the
 * React tree. If any ancestor in our provider stack (theme, auth, tooltip,
 * route layouts) ever introduces a stacking context (transform, filter,
 * will-change, contain, isolation), the toaster's huge z-index gets trapped
 * inside that context and can render BEHIND fullscreen Radix Dialogs
 * (PhotoLightbox in particular). Portaling to <body> guarantees the toaster
 * shares the topmost stacking context with the Radix portal targets.
 *
 * Combined with the `[data-sonner-toaster]` rule in index.css that locks
 * z-index to int32-max and `isolation: isolate`, this is bulletproof against
 * any future overlay being painted on top of toasts.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const isNative = Capacitor.isNativePlatform();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const topOffset = isNative ? "5rem" : "4rem";

  const node = (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      style={{
        // Backed up by the !important rule in index.css
        zIndex: 2147483647,
        top: topOffset,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:!h-10 group-[.toast]:!px-4 group-[.toast]:!text-sm group-[.toast]:!font-medium group-[.toast]:!rounded-md group-[.toast]:!min-w-[72px] group-[.toast]:!ml-2",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:!h-10 group-[.toast]:!px-4 group-[.toast]:!text-sm group-[.toast]:!rounded-md",
        },
      }}
      {...props}
    />
  );

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(node, document.body);
};

export { Toaster, toast };
