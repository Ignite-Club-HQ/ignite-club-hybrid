import { useState } from "react";
import { ArrowRight, Check, ChevronDown, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PlanFix } from "./planner/planFixes";

interface PlanFixSuggestionsProps {
  fixes: PlanFix[];
  /** The fix shown in the top slot — either the active priority or recommendation. */
  promoted: PlanFix | null;
  /** Currently applied priority id, or null if none. Mutually exclusive. */
  activeFixId: string | null;
  onApply: (fix: PlanFix) => void;
  readOnly: boolean;
}

export function PlanFixSuggestions({
  fixes,
  promoted,
  activeFixId,
  onApply,
  readOnly,
}: PlanFixSuggestionsProps) {
  const [showOthers, setShowOthers] = useState(false);
  if (readOnly || !promoted) return null;
  const others = fixes.filter((f) => f.id !== promoted.id);
  const isPromotedActive = activeFixId === promoted.id;
  const headerLabel = activeFixId ? "Current priority" : "Recommended priority";
  const buttonLabel = isPromotedActive ? "Recalculate plan" : "Use this priority";

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2.5 mb-2">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold text-primary">
        <Wand2 className="h-3.5 w-3.5" />
        {headerLabel}
      </div>
      <div>
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-foreground">{promoted.title}</p>
          {isPromotedActive && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              <Check className="h-2.5 w-2.5" />
              Current
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug mt-1">{promoted.tradeoff}</p>
      </div>
      <Button
        type="button"
        size="sm"
        className="w-full gap-1.5"
        onClick={() => onApply(promoted)}
      >
        <Wand2 className="h-3.5 w-3.5" />
        {buttonLabel}
      </Button>
      {others.length > 0 && (
        <div className="pt-1 border-t border-primary/20">
          <button
            type="button"
            onClick={() => setShowOthers((v) => !v)}
            className="flex items-center justify-between w-full text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <span>{activeFixId ? `Try a different priority (${others.length})` : `Other priorities (${others.length})`}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showOthers ? "rotate-180" : "")} />
          </button>
          {showOthers && (
            <div className="grid gap-1.5 mt-2">
              {others.map((fix) => (
                <button
                  key={fix.id}
                  type="button"
                  onClick={() => onApply(fix)}
                  className="text-left rounded-md border border-border bg-background hover:bg-muted/60 transition-colors p-2 min-h-[40px] group"
                >
                  <div className="flex items-start gap-2">
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-medium text-foreground">{fix.title}</span>
                      <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">
                        {fix.tradeoff}
                      </span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5 group-hover:text-foreground transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
