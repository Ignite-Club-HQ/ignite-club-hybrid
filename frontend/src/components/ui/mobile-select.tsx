import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";

interface MobileSelectOption {
  value: string;
  label: string;
}

interface MobileSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: MobileSelectOption[];
  placeholder?: string;
  title?: string;
  className?: string;
  triggerClassName?: string;
}

export function MobileSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  title = "Select an option",
  className,
  triggerClassName,
}: MobileSelectProps) {
  const [open, setOpen] = React.useState(false);

  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-11 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          !selectedLabel && "text-muted-foreground",
          triggerClassName
        )}
      >
        <span className="truncate">{selectedLabel || placeholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className={cn("max-h-[70vh]", className)}>
          <DrawerHeader className="border-b border-border pb-3">
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-2 py-2 pb-safe">
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <DrawerClose key={option.value} asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-3.5 text-left text-sm transition-colors",
                      isSelected
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-muted active:bg-muted"
                    )}
                    onClick={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <div className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      isSelected ? "border-primary bg-primary" : "border-muted-foreground/30"
                    )}>
                      {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                    <span className="flex-1">{option.label}</span>
                  </button>
                </DrawerClose>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
