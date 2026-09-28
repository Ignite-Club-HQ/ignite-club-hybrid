import * as React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";

interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  forceDesktopDialog?: boolean;
}

interface ResponsiveDialogContentProps {
  children: React.ReactNode;
  className?: string;
  fullScreen?: boolean;
}

interface ResponsiveDialogHeaderProps {
  children: React.ReactNode;
  className?: string;
}

interface ResponsiveDialogFooterProps {
  children: React.ReactNode;
  className?: string;
}

interface ResponsiveDialogTitleProps {
  children: React.ReactNode;
  className?: string;
}

interface ResponsiveDialogDescriptionProps {
  children: React.ReactNode;
  className?: string;
}

const ResponsiveDialogContext = React.createContext<{ isMobile: boolean }>({
  isMobile: false,
});

export function ResponsiveDialog({
  open,
  onOpenChange,
  children,
  forceDesktopDialog = false,
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile();
  const useDrawer = isMobile && !forceDesktopDialog;

  if (useDrawer) {
    return (
      <ResponsiveDialogContext.Provider value={{ isMobile: true }}>
        <Drawer open={open} onOpenChange={onOpenChange}>
          {children}
        </Drawer>
      </ResponsiveDialogContext.Provider>
    );
  }

  return (
    <ResponsiveDialogContext.Provider value={{ isMobile: false }}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {children}
      </Dialog>
    </ResponsiveDialogContext.Provider>
  );
}

export function ResponsiveDialogContent({
  children,
  className,
  fullScreen = false,
}: ResponsiveDialogContentProps) {
  const { isMobile } = React.useContext(ResponsiveDialogContext);

  if (isMobile) {
    return (
      <DrawerContent
        className={
          fullScreen
            // Keep the full-screen drawer bottom-anchored. Setting `top` as well
            // as `bottom` and an explicit height over-constrains the box; mobile
            // browsers may then drop `bottom` and place the action footer below
            // the viewport. `mt-0` also cancels DrawerContent's default offset.
            ? "mt-0"
            : className
        }
        style={
          fullScreen
            ? {
                // On Android the WebView's dvh shrinks with the soft keyboard and
                // does not restore reliably, leaving a blank gap under the sheet.
                // --visual-vh is monotonic-max locked, so it stays stable — but a
                // stale (too tall) lock would push the anchored footer BELOW the
                // screen, hiding the primary action. Clamp against 100vh (the
                // largest stable viewport, unaffected by the keyboard).
                height:
                  "calc(min(var(--visual-vh, 100dvh), 100vh) - env(safe-area-inset-top,0px))",
                maxHeight:
                  "calc(min(var(--visual-vh, 100dvh), 100vh) - env(safe-area-inset-top,0px))",
              }
            : undefined
        }

      >
        <div className={fullScreen 
          ? "flex flex-1 min-h-0 flex-col w-full overflow-hidden" 
          : "mx-auto w-full max-w-lg px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] max-h-[85vh] overflow-y-auto"
        }>
          {children}
        </div>
      </DrawerContent>
    );
  }

  return <DialogContent className={className}>{children}</DialogContent>;
}

export function ResponsiveDialogHeader({
  children,
  className,
}: ResponsiveDialogHeaderProps) {
  const { isMobile } = React.useContext(ResponsiveDialogContext);

  if (isMobile) {
    return <DrawerHeader className={className}>{children}</DrawerHeader>;
  }

  return <DialogHeader className={className}>{children}</DialogHeader>;
}

export function ResponsiveDialogFooter({
  children,
  className,
}: ResponsiveDialogFooterProps) {
  const { isMobile } = React.useContext(ResponsiveDialogContext);

  if (isMobile) {
    return <DrawerFooter className={className}>{children}</DrawerFooter>;
  }

  return <DialogFooter className={className}>{children}</DialogFooter>;
}

export function ResponsiveDialogTitle({
  children,
  className,
}: ResponsiveDialogTitleProps) {
  const { isMobile } = React.useContext(ResponsiveDialogContext);

  if (isMobile) {
    return <DrawerTitle className={className}>{children}</DrawerTitle>;
  }

  return <DialogTitle className={className}>{children}</DialogTitle>;
}

export function ResponsiveDialogDescription({
  children,
  className,
}: ResponsiveDialogDescriptionProps) {
  const { isMobile } = React.useContext(ResponsiveDialogContext);

  if (isMobile) {
    return (
      <DrawerDescription className={className}>{children}</DrawerDescription>
    );
  }

  return <DialogDescription className={className}>{children}</DialogDescription>;
}

export { DrawerClose as ResponsiveDialogClose };
