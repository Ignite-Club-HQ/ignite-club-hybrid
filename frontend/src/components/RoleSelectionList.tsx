import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type RoleSelectionOption<T extends string = string> = {
  value: T;
  label: string;
  description: string;
  color: string;
};

type RoleSelectionListProps<T extends string> = {
  options: readonly RoleSelectionOption<T>[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  className?: string;
};

export function RoleSelectionList<T extends string>({
  options,
  selected,
  onToggle,
  className,
}: RoleSelectionListProps<T>) {
  return (
    <div className={cn("space-y-3 py-4", className)}>
      {options.map((role) => {
        const isSelected = selected.includes(role.value);
        return (
          <button
            key={role.value}
            type="button"
            onClick={() => onToggle(role.value)}
            aria-pressed={isSelected}
            className={cn(
              "w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left",
              isSelected
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/50",
            )}
          >
            <div className={cn(
              "h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
              isSelected ? "border-primary bg-primary" : "border-muted-foreground/30",
            )}>
              {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-xs font-medium px-2 py-0.5 rounded-full border",
                  role.color,
                )}>
                  {role.label}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {role.description}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
