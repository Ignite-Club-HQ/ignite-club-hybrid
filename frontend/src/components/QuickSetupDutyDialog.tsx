import { useState, useEffect } from "react";
import { Loader2, Wand2, Megaphone, Apple, Check, Shuffle, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ParentMember {
  id: string;
  display_name: string;
  avatar_url?: string | null;
}

export type AbilityMode = "similar" | "mixed";

interface QuickSetupDutyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (data: { assignments: Record<string, string[]>; abilityMode: AbilityMode }) => void;
  isPending: boolean;
  parents: ParentMember[];
  playerCount: number;
}

const DUTIES = [
  { id: "Referee", label: "Referee", icon: Megaphone, description: "Officiate the games" },
  { id: "Oranges", label: "Oranges", icon: Apple, description: "Half-time oranges" },
];

export function QuickSetupDutyDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
  parents,
  playerCount,
}: QuickSetupDutyDialogProps) {
  const [assignments, setAssignments] = useState<Record<string, string[]>>({
    Referee: [],
    Oranges: [],
  });
  const [expandedDuty, setExpandedDuty] = useState<string | null>(null);
  const [abilityMode, setAbilityMode] = useState<AbilityMode>("mixed");

  useEffect(() => {
    if (open) {
      setAssignments({ Referee: [], Oranges: [] });
      setExpandedDuty(null);
      setAbilityMode("mixed");
    }
  }, [open]);

  const toggleParent = (dutyId: string, parentId: string) => {
    setAssignments(prev => {
      const current = prev[dutyId] || [];
      const isSelected = current.includes(parentId);
      return {
        ...prev,
        [dutyId]: isSelected
          ? current.filter(id => id !== parentId)
          : [...current, parentId],
      };
    });
  };

  const getAssigneeNames = (dutyId: string) => {
    const userIds = assignments[dutyId] || [];
    if (userIds.length === 0) return null;
    return userIds
      .map(id => parents.find(p => p.id === id))
      .filter(Boolean) as ParentMember[];
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            Generate Matches
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {playerCount} players will be split into balanced games. Assign duties below before generating.
          </p>

          {/* Ability Grouping */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Grouping</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAbilityMode("mixed")}
                className={cn(
                  "flex items-center gap-2.5 p-3 rounded-xl border-2 transition-all text-left touch-manipulation",
                  abilityMode === "mixed"
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-primary/50"
                )}
              >
                <Shuffle className={cn("h-4 w-4", abilityMode === "mixed" ? "text-primary" : "text-muted-foreground")} />
                <div>
                  <p className="text-sm font-medium">Mixed</p>
                  <p className="text-[10px] text-muted-foreground">Balanced teams</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setAbilityMode("similar")}
                className={cn(
                  "flex items-center gap-2.5 p-3 rounded-xl border-2 transition-all text-left touch-manipulation",
                  abilityMode === "similar"
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-primary/50"
                )}
              >
                <Layers className={cn("h-4 w-4", abilityMode === "similar" ? "text-primary" : "text-muted-foreground")} />
                <div>
                  <p className="text-sm font-medium">Similar</p>
                  <p className="text-[10px] text-muted-foreground">Same levels</p>
                </div>
              </button>
            </div>
          </div>

          {/* Duties */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Duties (optional)</p>
            {DUTIES.map((duty) => {
              const assignees = getAssigneeNames(duty.id);
              const isExpanded = expandedDuty === duty.id;
              const Icon = duty.icon;
              const count = (assignments[duty.id] || []).length;

              return (
                <div key={duty.id} className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setExpandedDuty(isExpanded ? null : duty.id)}
                    className={cn(
                      "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
                      "touch-manipulation focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                      isExpanded
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "p-2.5 rounded-full transition-colors",
                        isExpanded ? "bg-primary text-primary-foreground" : "bg-muted"
                      )}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-medium">{duty.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {assignees && assignees.length > 0
                            ? assignees.map(a => a.display_name).join(", ")
                            : "Tap to assign"}
                        </p>
                      </div>
                    </div>
                    {count > 0 && (
                      <div className="flex -space-x-2">
                        {assignees?.slice(0, 3).map((a) => (
                          <Avatar key={a.id} className="h-8 w-8 border-2 border-primary">
                            <AvatarImage src={a.avatar_url || undefined} />
                            <AvatarFallback className="text-xs">
                              {a.display_name?.charAt(0)?.toUpperCase() || "?"}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {count > 3 && (
                          <div className="h-8 w-8 rounded-full bg-muted border-2 border-primary flex items-center justify-center text-xs font-medium">
                            +{count - 3}
                          </div>
                        )}
                      </div>
                    )}
                  </button>

                  {isExpanded && (
                    <ScrollArea className="max-h-[200px]">
                      <div className="space-y-1.5 pl-2">
                        {parents.map((parent) => {
                          const isSelected = (assignments[duty.id] || []).includes(parent.id);
                          return (
                            <button
                              key={parent.id}
                              type="button"
                              onClick={() => toggleParent(duty.id, parent.id)}
                              className={cn(
                                "w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left",
                                "touch-manipulation hover:bg-accent",
                                isSelected ? "bg-primary/10" : ""
                              )}
                            >
                              <Avatar className={cn(
                                "h-8 w-8 border-2",
                                isSelected ? "border-primary" : "border-transparent"
                              )}>
                                <AvatarImage src={parent.avatar_url || undefined} />
                                <AvatarFallback className="text-xs bg-muted">
                                  {parent.display_name?.charAt(0)?.toUpperCase() || "?"}
                                </AvatarFallback>
                              </Avatar>
                              <span className={cn(
                                "text-sm font-medium flex-1",
                                isSelected ? "text-primary" : "text-foreground"
                              )}>
                                {parent.display_name}
                              </span>
                              {isSelected && (
                                <Check className="h-4 w-4 text-primary shrink-0" />
                              )}
                            </button>
                          );
                        })}

                        {parents.length === 0 && (
                          <p className="text-sm text-muted-foreground py-3 text-center">
                            No parents available
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <ResponsiveDialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm({ assignments, abilityMode })}
            disabled={isPending}
            className="flex-1 sm:flex-none"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Wand2 className="h-4 w-4 mr-2" />
            )}
            Generate Matches
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
