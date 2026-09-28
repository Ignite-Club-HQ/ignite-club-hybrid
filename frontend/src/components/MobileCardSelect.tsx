import * as React from "react";
import { Check, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";

interface Option {
  value: string;
  label: string;
  icon?: React.ReactNode;
  description?: string;
  disabled?: boolean;
}

interface MobileCardSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  required?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

export function MobileCardSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  label,
  disabled = false,
  required = false,
  searchable = false,
  searchPlaceholder = "Search...",
  emptyMessage = "No options found.",
}: MobileCardSelectProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const selectedOption = options.find((opt) => opt.value === value);

  const filteredOptions = searchable && search
    ? options.filter((opt) => 
        opt.label.toLowerCase().includes(search.toLowerCase())
      )
    : options;

  // Reset search when drawer closes
  React.useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          onClick={() => !disabled && setOpen(true)}
          disabled={disabled}
          className={cn(
            "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
            "bg-card hover:bg-accent/50",
            value ? "border-primary" : "border-border",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <div className="flex flex-col gap-0.5">
            {label && (
              <span className="text-xs text-muted-foreground font-medium">
                {label}
                {required && <span className="text-destructive ml-1">*</span>}
              </span>
            )}
            <span className={cn(
              "text-base font-medium flex items-center gap-2",
              !selectedOption && "text-muted-foreground"
            )}>
              {selectedOption?.icon}
              {selectedOption?.label || placeholder}
            </span>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>

        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent>
            <DrawerHeader className="text-left">
              <DrawerTitle>{label || "Select"}</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-8 space-y-3">
              {searchable && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={searchPlaceholder}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10 h-11"
                  />
                </div>
              )}
              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                {filteredOptions.length === 0 ? (
                  <div className="py-6 text-center text-muted-foreground">
                    {emptyMessage}
                  </div>
                ) : (
                  filteredOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      disabled={option.disabled}
                      onClick={() => {
                        if (option.disabled) return;
                        onValueChange(option.value);
                        setOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
                        option.disabled
                          ? "opacity-50 cursor-not-allowed border-border bg-muted"
                          : "hover:bg-accent/50",
                        !option.disabled && value === option.value
                          ? "border-primary bg-primary/5"
                          : !option.disabled ? "border-border bg-card" : ""
                      )}
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="text-base font-medium flex items-center gap-2">
                          {option.icon}
                          {option.label}
                        </span>
                        {option.description && (
                          <span className="text-xs text-muted-foreground">{option.description}</span>
                        )}
                      </div>
                      {value === option.value && !option.disabled && (
                        <Check className="h-5 w-5 text-primary" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  // Desktop: Use standard Select with label
  return (
    <div className="space-y-2">
      {label && (
        <label className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </label>
      )}
      <Select value={value} onValueChange={onValueChange} disabled={disabled || options.length === 0}>
        <SelectTrigger className="w-full h-12 text-base">
          <SelectValue placeholder={options.length === 0 ? "No options available" : placeholder} />
        </SelectTrigger>
        <SelectContent
          className="max-h-[40vh] w-[var(--radix-select-trigger-width)] min-w-[200px] z-[1000002] bg-popover"
          position="popper"
          sideOffset={4}
          align="start"
        >
          {options.length === 0 ? (
            <div className="py-3 px-2 text-sm text-muted-foreground text-center">
              No options available
            </div>
          ) : (
            options.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="py-3 text-base cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  {option.icon}
                  {option.label}
                  {option.description && (
                    <span className="text-xs text-muted-foreground">({option.description})</span>
                  )}
                </span>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
