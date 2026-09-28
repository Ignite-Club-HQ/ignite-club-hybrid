import { useState, useMemo } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

const JUNIOR_GROUPS = [
  "U5", "U6", "U7", "U8", "U9", "U10", "U11", "U12",
  "U13", "U14", "U15", "U16", "U17", "U18", "U19", "U21",
];

const SENIOR_GROUPS = [
  "Senior", "Veterans", "Open Age",
  "Division 1", "Division 2", "Division 3", "Division 4",
  "Premier League", "Reserve Grade",
];

export type TeamTypeForLevel = "junior" | "senior" | "mixed";

interface LevelAgeComboboxProps {
  value: string;
  onChange: (value: string) => void;
  /** Drives which levels are offered — comes from the Team Type selector. */
  teamType?: TeamTypeForLevel;
  className?: string;
}

export function LevelAgeCombobox({ value, onChange, teamType = "mixed", className }: LevelAgeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const isMobile = useIsMobile();

  const options = useMemo(() => {
    if (teamType === "junior") return JUNIOR_GROUPS;
    if (teamType === "senior") return SENIOR_GROUPS;
    return [...JUNIOR_GROUPS, ...SENIOR_GROUPS];
  }, [teamType]);

  const filteredOptions = useMemo(() => {
    if (!searchQuery) return options;
    const q = searchQuery.toLowerCase();
    return options.filter((opt) => opt.toLowerCase().includes(q));
  }, [searchQuery, options]);

  const showCustomOption = searchQuery && !options.some(
    (opt) => opt.toLowerCase() === searchQuery.toLowerCase()
  );

  const placeholder =
    teamType === "junior"
      ? "Select age group"
      : teamType === "senior"
      ? "Select grade / division"
      : "Select level / age group";

  const commit = (next: string) => {
    onChange(next);
    setSearchQuery("");
    setOpen(false);
  };


  const commandList = (
    <Command shouldFilter={false} className="max-h-full">
      <CommandInput
        placeholder="Search or type custom..."
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList className={cn("overflow-y-auto overscroll-contain", isMobile ? "max-h-[50dvh]" : "max-h-[min(48dvh,320px)]")}>
        <CommandEmpty>No matches found.</CommandEmpty>
        <CommandGroup>
          {showCustomOption && (
            <CommandItem
              value={searchQuery}
              onSelect={() => {
                onChange(searchQuery);
                setSearchQuery("");
                setOpen(false);
              }}
            >
              <Check className={cn("mr-2 h-4 w-4 opacity-0")} />
              Use "{searchQuery}"
            </CommandItem>
          )}
          {filteredOptions.map((option) => (
            <CommandItem
              key={option}
              value={option}
              onSelect={() => {
                onChange(option);
                setSearchQuery("");
                setOpen(false);
              }}
            >
              <Check
                className={cn(
                  "mr-2 h-4 w-4",
                  value === option ? "opacity-100" : "opacity-0"
                )}
              />
              {option}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );

  const trigger = (
    <Button
      variant="outline"
      role="combobox"
      aria-expanded={open}
      onClick={isMobile ? () => setOpen(true) : undefined}
      className={cn(
        "w-full justify-between font-normal h-12 text-base bg-muted/50 border-muted-foreground/20 hover:bg-background transition-colors",
        !value && "text-muted-foreground"
      )}
    >
      <span className="truncate">{value || placeholder}</span>
      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
    </Button>
  );

  if (isMobile) {
    // Mobile: full-width drawer with a tap-friendly chip grid instead of a
    // long single-column list, so short values like "U12" don't force the
    // sheet to overflow the viewport on narrow screens.
    return (
      <div className={cn("w-full min-w-0", className)}>
        {trigger}
        <Drawer open={open} onOpenChange={setOpen} autoFocus={false}>
          <DrawerContent className="max-h-[85dvh]">
            <div className="mx-auto flex w-full max-w-lg min-w-0 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <DrawerHeader className="px-0 pb-2">
                <DrawerTitle className="text-base">{placeholder}</DrawerTitle>
              </DrawerHeader>
              <Input
                autoFocus={false}
                inputMode="text"
                placeholder="Search or type custom..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 text-base"
              />
              <div className="mt-3 overflow-y-auto overscroll-contain max-h-[55dvh]">
                {showCustomOption && (
                  <button
                    type="button"
                    onClick={() => commit(searchQuery)}
                    className="mb-3 w-full rounded-xl border-2 border-primary/40 bg-primary/5 px-3 py-3 text-left text-base font-medium text-primary"
                  >
                    <span className="block truncate">Use "{searchQuery}"</span>
                  </button>
                )}
                {filteredOptions.length === 0 && !showCustomOption ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No matches found.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 pb-2 sm:grid-cols-4">
                    {filteredOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => commit(option)}
                        className={cn(
                          "flex min-h-11 items-center justify-center rounded-xl border-2 px-2 py-2 text-center text-sm font-medium transition-colors",
                          value === option
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-muted/40 text-foreground"
                        )}
                      >
                        <span className="block w-full truncate leading-tight">{option}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    );
  }


  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0 max-h-[min(60dvh,var(--radix-popover-content-available-height))] overflow-hidden"
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={12}
          avoidCollisions
        >
          {commandList}
        </PopoverContent>
      </Popover>
    </div>
  );
}
