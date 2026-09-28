import { cn } from "@/lib/utils";
import { TacticalMode } from "./tacticalMode";
import { Shield, Swords, Circle } from "lucide-react";

interface TacticalModeSelectorProps {
  value: TacticalMode;
  onChange: (mode: TacticalMode) => void;
  readOnly?: boolean;
}

const modes: { value: TacticalMode; label: string; icon: typeof Shield }[] = [
  { value: "defend", label: "Defend", icon: Shield },
  { value: "neutral", label: "Neutral", icon: Circle },
  { value: "attack", label: "Attack", icon: Swords },
];

const TacticalModeSelector = ({ value, onChange, readOnly }: TacticalModeSelectorProps) => {
  if (readOnly) return null;

  return (
    <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
      {modes.map(({ value: mode, label, icon: Icon }) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-all duration-200",
            value === mode
              ? mode === "attack"
                ? "bg-orange-500/20 text-orange-500 shadow-sm"
                : mode === "defend"
                  ? "bg-blue-500/20 text-blue-500 shadow-sm"
                  : "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
};

export default TacticalModeSelector;
