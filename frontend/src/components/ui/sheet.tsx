import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { useIOSScrollLock } from "@/hooks/useIOSScrollLock";

type SheetProps = React.ComponentPropsWithoutRef<typeof SheetPrimitive.Root> & {
  modal?: boolean;
};

type SheetOpenContextValue = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

const SheetOpenContext = React.createContext<SheetOpenContextValue>({
  onOpenChange: () => undefined,
  open: false,
});

const Sheet = ({ open, defaultOpen, onOpenChange, modal, children, ...props }: SheetProps) => {
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);
  const isOpen = isControlled ? Boolean(open) : internalOpen;

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setInternalOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange]
  );

  return (
    <SheetOpenContext.Provider value={{ open: isOpen, onOpenChange: handleOpenChange }}>
      <SheetPrimitive.Root
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={handleOpenChange}
        modal={modal}
        {...props}
      >
        {children}
      </SheetPrimitive.Root>
    </SheetOpenContext.Provider>
  );
};

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-[100008] bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "fixed z-[100009] gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "left-0 bottom-0 w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "right-0 bottom-0 w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  enableDragToClose?: boolean;
  dragCloseThreshold?: number;
  hideCloseButton?: boolean;
  hideOverlay?: boolean;
}

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side = "right", className, children, hideCloseButton, hideOverlay, style, enableDragToClose = false, dragCloseThreshold = 96, ...props }, ref) => {
    const { open: isSheetOpen, onOpenChange } = React.useContext(SheetOpenContext);
    const dragStartYRef = React.useRef(0);
    const [dragOffsetY, setDragOffsetY] = React.useState(0);
    const [isDragging, setIsDragging] = React.useState(false);

    useIOSScrollLock(isSheetOpen);

    const setContentRefs = React.useCallback(
      (node: React.ElementRef<typeof SheetPrimitive.Content> | null) => {
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      [ref]
    );

    const handleDragStart = React.useCallback((event: React.TouchEvent<HTMLDivElement>) => {
      if (!enableDragToClose || side !== "bottom") return;

      dragStartYRef.current = event.touches[0]?.clientY ?? 0;
      setIsDragging(true);
    }, [enableDragToClose, side]);

    const handleDragMove = React.useCallback((event: React.TouchEvent<HTMLDivElement>) => {
      if (!enableDragToClose || side !== "bottom" || !isDragging) return;

      const currentY = event.touches[0]?.clientY ?? dragStartYRef.current;
      const nextOffset = Math.max(0, currentY - dragStartYRef.current);

      setDragOffsetY(nextOffset);

      if (nextOffset > 0) {
        event.preventDefault();
      }
    }, [enableDragToClose, isDragging, side]);

    const handleDragEnd = React.useCallback(() => {
      if (!enableDragToClose || side !== "bottom") return;

      setIsDragging(false);

      if (dragOffsetY >= dragCloseThreshold) {
        onOpenChange(false);
        setDragOffsetY(0);
        return;
      }

      setDragOffsetY(0);
    }, [dragCloseThreshold, dragOffsetY, enableDragToClose, onOpenChange, side]);

    // Apply safe area positioning via inline styles for better cross-platform support
    const safeAreaStyle = React.useMemo(() => {
      const baseStyle = style || {};
      if (side === "left" || side === "right") {
        return {
          ...baseStyle,
          top: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        };
      }
      if (side === "bottom") {
        return {
          ...baseStyle,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          transform: dragOffsetY > 0 ? `translateY(${dragOffsetY}px)` : undefined,
          transitionDuration: isDragging ? '0ms' : dragOffsetY > 0 ? '200ms' : undefined,
          transitionProperty: dragOffsetY > 0 || isDragging ? 'transform' : undefined,
          transitionTimingFunction: dragOffsetY > 0 ? 'ease-out' : undefined,
          willChange: dragOffsetY > 0 ? 'transform' : undefined,
        };
      }
      return baseStyle;
    }, [dragOffsetY, isDragging, side, style]);

    return (
      <SheetPortal>
        {!hideOverlay && <SheetOverlay />}
        <SheetPrimitive.Content 
          ref={setContentRefs}
          className={cn(sheetVariants({ side }), className)} 
          style={safeAreaStyle}
          {...props}
        >
          {enableDragToClose && side === "bottom" && (
            <div
              aria-hidden="true"
              className="flex justify-center pt-2 pb-1"
              onTouchEnd={handleDragEnd}
              onTouchMove={handleDragMove}
              onTouchStart={handleDragStart}
              onTouchCancel={handleDragEnd}
            >
              <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
            </div>
          )}
          {children}
          {!hideCloseButton && (
            <SheetPrimitive.Close 
              className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-secondary hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </SheetPrimitive.Close>
          )}
        </SheetPrimitive.Content>
      </SheetPortal>
    );
  }
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn("text-lg font-semibold text-foreground", className)} {...props} />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
