import type { ReactNode } from "react";
import { Baby, Check, ChevronDown, Loader2, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

type RsvpStatus = "going" | "maybe" | "not_going";

interface RsvpOption {
  status: RsvpStatus;
  label: string;
  icon: ReactNode;
  activeClass: string;
  inactiveHint: string;
}

interface EventChild {
  id: string;
  name: string;
}

interface ChildRsvp {
  child_id: string;
  status: string;
}

interface NextUpHeroRsvpSectionProps {
  childrenOnEvent: EventChild[];
  childRsvpPending: boolean;
  childRsvpPendingChildId?: string;
  childRsvpPendingStatus?: RsvpStatus;
  childRsvps?: ChildRsvp[];
  currentStatus: RsvpStatus | null;
  guardianUnrespondedCount: number;
  hasGuardianChildren: boolean;
  heroDataReady: boolean;
  onChildRsvp: (childId: string, status: RsvpStatus) => void;
  onRsvp: (status: RsvpStatus) => void;
  onToggleParentRsvp: () => void;
  parentFirstEvent: boolean;
  parentRsvpOpen: boolean;
  rsvpGroupNoun: string;
  rsvpOptions: RsvpOption[];
  rsvpPending: boolean;
  rsvpPendingStatus?: RsvpStatus;
  rsvpSummaryTotalCount: number;
}

interface RsvpChoiceButtonProps {
  activeClass: string;
  ariaLabel: string;
  className: string;
  disabled?: boolean;
  icon: ReactNode;
  inactiveHint: string;
  isActive: boolean;
  isPending?: boolean;
  label: string;
  onClick: () => void;
}

function RsvpChoiceButton({
  activeClass,
  ariaLabel,
  className,
  disabled = false,
  icon,
  inactiveHint,
  isActive,
  isPending = false,
  label,
  onClick,
}: RsvpChoiceButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={isActive}
      aria-label={ariaLabel}
      className={`${className} transition-all duration-200 ease-out will-change-transform ${
        isActive ? `${activeClass} font-semibold animate-scale-in` : `${inactiveHint} font-medium active:scale-[0.97]`
      }`}
      disabled={disabled}
      onClick={() => !isActive && onClick()}
    >
      {isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : isActive ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        icon
      )}
      <span className="truncate">{label}</span>
    </Button>
  );
}

export function NextUpHeroRsvpSection({
  childrenOnEvent,
  childRsvpPending,
  childRsvpPendingChildId,
  childRsvpPendingStatus,
  childRsvps,
  currentStatus,
  guardianUnrespondedCount,
  hasGuardianChildren,
  heroDataReady,
  onChildRsvp,
  onRsvp,
  onToggleParentRsvp,
  parentFirstEvent,
  parentRsvpOpen,
  rsvpGroupNoun,
  rsvpOptions,
  rsvpPending,
  rsvpPendingStatus,
  rsvpSummaryTotalCount,
}: NextUpHeroRsvpSectionProps) {
  if (hasGuardianChildren && !parentFirstEvent) {
    const teammatesGoing = rsvpSummaryTotalCount;
    const isSingleChild = childrenOnEvent.length === 1;
    const soleChild = isSingleChild ? childrenOnEvent[0] : null;
    const soleChildFirst = soleChild ? (soleChild.name.split(" ")[0] || soleChild.name) : "";
    const soleChildRsvp = soleChild ? childRsvps?.find((r) => r.child_id === soleChild.id) : undefined;

    const applyAllPending = childRsvpPending;
    const applyAllToChildren = (status: RsvpStatus) => {
      childrenOnEvent.forEach((child) => {
        const existing = childRsvps?.find((r) => r.child_id === child.id);
        if (existing?.status === status) return;
        onChildRsvp(child.id, status);
      });
    };

    const childStatusLines = childrenOnEvent
      .map((child) => {
        const r = childRsvps?.find((rsvp) => rsvp.child_id === child.id);
        const first = child.name.split(" ")[0] || child.name;
        if (r?.status === "going") return `${first} is going`;
        if (r?.status === "maybe") return `${first} might go`;
        if (r?.status === "not_going") return `${first} can't go`;
        return null;
      })
      .filter(Boolean) as string[];

    return (
      <div className="space-y-2 pt-1">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
          <Baby className="h-3.5 w-3.5 text-primary shrink-0" />
          {isSingleChild ? (
            soleChildRsvp
              ? <span>RSVP for {soleChildFirst}</span>
              : <span>Can {soleChildFirst} attend?</span>
          ) : (
            guardianUnrespondedCount > 0
              ? <span>{guardianUnrespondedCount === childrenOnEvent.length
                  ? `${childrenOnEvent.length} ${rsvpGroupNoun} need RSVP`
                  : `${guardianUnrespondedCount} of ${childrenOnEvent.length} ${rsvpGroupNoun} need RSVP`}</span>
              : <span>RSVP for your {rsvpGroupNoun}</span>
          )}
        </div>

        {isSingleChild ? (
          <div className="flex gap-2">
            {rsvpOptions.map(({ status, label, icon, activeClass, inactiveHint }) => {
              const isActive = soleChildRsvp?.status === status;
              const isThisPending =
                childRsvpPending &&
                childRsvpPendingChildId === soleChild!.id &&
                childRsvpPendingStatus === status;
              return (
                <RsvpChoiceButton
                  key={status}
                  activeClass={activeClass}
                  ariaLabel={`${soleChildFirst} RSVP ${label}`}
                  className="flex-1 gap-1.5 text-[12px] h-9 rounded-full"
                  disabled={childRsvpPending}
                  icon={icon}
                  inactiveHint={inactiveHint}
                  isActive={isActive}
                  isPending={isThisPending}
                  label={label}
                  onClick={() => onChildRsvp(soleChild!.id, status)}
                />
              );
            })}
          </div>
        ) : (
          <div className="space-y-1.5">
            {childrenOnEvent.map((child) => {
              const childRsvp = childRsvps?.find((r) => r.child_id === child.id);
              const first = child.name.split(" ")[0] || child.name;
              const isUnresponded = !childRsvp;
              return (
                <div key={child.id} className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[11.5px]">
                    <span className={`font-semibold ${isUnresponded ? "text-foreground" : "text-foreground/85"}`}>{first}</span>
                    {isUnresponded && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-destructive">
                        <span className="relative inline-flex h-1.5 w-1.5" aria-hidden>
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-70" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
                        </span>
                        needs RSVP
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {rsvpOptions.map(({ status, label, icon, activeClass, inactiveHint }) => {
                      const isActive = childRsvp?.status === status;
                      const isThisPending =
                        childRsvpPending &&
                        childRsvpPendingChildId === child.id &&
                        childRsvpPendingStatus === status;
                      return (
                        <RsvpChoiceButton
                          key={`${child.id}-${status}`}
                          activeClass={activeClass}
                          ariaLabel={`${child.name} RSVP ${label}`}
                          className="h-8 gap-1 px-2 text-[11px] rounded-full"
                          disabled={childRsvpPending}
                          icon={icon}
                          inactiveHint={inactiveHint}
                          isActive={isActive}
                          isPending={isThisPending}
                          label={label}
                          onClick={() => onChildRsvp(child.id, status)}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="flex items-center gap-1.5 pt-1">
              <span className="text-[10px] text-muted-foreground">Apply to all:</span>
              {rsvpOptions.map(({ status, label, icon }) => (
                <button
                  key={`all-${status}`}
                  type="button"
                  disabled={applyAllPending}
                  onClick={() => applyAllToChildren(status)}
                  className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium text-foreground/80 hover:bg-muted/40 transition-colors disabled:opacity-50"
                  aria-label={`Apply ${label} to all children`}
                >
                  {icon}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border/25 bg-muted/[0.06] px-2.5 py-1.5 space-y-0.5 opacity-75">
          {childStatusLines.length > 0 ? (
            childStatusLines.map((line, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground font-medium">
                <User className="h-3 w-3 shrink-0 opacity-60" />
                <span className="truncate">{line}</span>
              </div>
            ))
          ) : (
            <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/80">
              <User className="h-3 w-3 shrink-0 opacity-60" />
              <span className="truncate">
                {isSingleChild ? `${soleChildFirst} hasn't been RSVP'd yet` : "Players awaiting RSVP"}
              </span>
            </div>
          )}
          {teammatesGoing > 0 && (
            <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/80">
              <Users className="h-3 w-3 shrink-0 opacity-60" />
              <span>{teammatesGoing} {teammatesGoing === 1 ? "teammate" : "teammates"} going</span>
            </div>
          )}
        </div>

        <div className="pt-0.5">
          <button
            type="button"
            onClick={onToggleParentRsvp}
            aria-expanded={parentRsvpOpen}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
          >
            <span>
              {currentStatus ? "Your attendance" : "Are you attending too?"}
            </span>
            <ChevronDown className={`h-3 w-3 transition-transform ${parentRsvpOpen ? "rotate-180" : ""}`} />
          </button>
          {parentRsvpOpen && (
            <div className="flex gap-1.5 pt-1.5">
              {rsvpOptions.map(({ status, label, icon, activeClass, inactiveHint }) => {
                const isActive = currentStatus === status;
                const isThisPending = rsvpPending && rsvpPendingStatus === status;
                return (
                  <RsvpChoiceButton
                    key={`parent-${status}`}
                    activeClass={activeClass}
                    ariaLabel={`Your RSVP ${label}`}
                    className="flex-1 h-8 gap-1 px-2 text-[11px] rounded-full"
                    disabled={rsvpPending}
                    icon={icon}
                    inactiveHint={inactiveHint}
                    isActive={isActive}
                    isPending={isThisPending}
                    label={label}
                    onClick={() => onRsvp(status)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 pt-1">
      <div className="flex gap-2">
        {rsvpOptions.map(({ status, label, icon, activeClass, inactiveHint }) => {
          const isActive = currentStatus === status;
          const isThisPending = rsvpPending && rsvpPendingStatus === status;
          return (
            <RsvpChoiceButton
              key={status}
              activeClass={activeClass}
              ariaLabel={`RSVP ${label}`}
              className="flex-1 gap-1.5 text-[12px] h-9 rounded-full"
              disabled={rsvpPending}
              icon={icon}
              inactiveHint={inactiveHint}
              isActive={isActive}
              isPending={isThisPending}
              label={label}
              onClick={() => onRsvp(status)}
            />
          );
        })}
      </div>

      {(() => {
        if (!heroDataReady) {
          return <p className="text-[11px] text-muted-foreground/60 text-center invisible">placeholder</p>;
        }
        const teammatesGoing = rsvpSummaryTotalCount;
        if (currentStatus && teammatesGoing === 0) return null;
        return (
          <div className="rounded-xl border border-border/20 bg-muted/[0.04] px-2.5 py-1.5 space-y-0.5 opacity-70">
            {teammatesGoing > 0 && (
              <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/80">
                <Users className="h-3 w-3 shrink-0 opacity-60" />
                <span>{teammatesGoing} {teammatesGoing === 1 ? "teammate" : "teammates"} going</span>
              </div>
            )}
            {!currentStatus && (
              <p className="text-[10px] text-muted-foreground/70 italic">
                Tap an option above to RSVP
              </p>
            )}
          </div>
        );
      })()}

      {parentFirstEvent && hasGuardianChildren && (
        <div className="pt-0.5">
          <button
            type="button"
            onClick={onToggleParentRsvp}
            aria-expanded={parentRsvpOpen}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors touch-manipulation"
          >
            <Baby className="h-3 w-3" />
            <span>RSVP your {childrenOnEvent.length === 1 ? "child" : "children"} too?</span>
            <ChevronDown className={`h-3 w-3 transition-transform ${parentRsvpOpen ? "rotate-180" : ""}`} />
          </button>
          {parentRsvpOpen && (
            <div className="space-y-2 pt-2">
              {childrenOnEvent.map((child) => {
                const childRsvp = childRsvps?.find((r) => r.child_id === child.id);
                const first = child.name.split(" ")[0] || child.name;
                return (
                  <div key={child.id} className="space-y-1">
                    <div className="text-[11px] font-medium text-foreground/85">{first}</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {rsvpOptions.map(({ status, label, icon, activeClass, inactiveHint }) => {
                        const isActive = childRsvp?.status === status;
                        return (
                          <Button
                            key={`${child.id}-${status}`}
                            variant="outline"
                            size="sm"
                            aria-pressed={isActive}
                            aria-label={`${child.name} RSVP ${label}`}
                            className={`h-8 gap-1 px-2 text-[11px] rounded-full transition-all duration-200 ease-out will-change-transform ${
                              isActive ? `${activeClass} font-semibold animate-scale-in` : `${inactiveHint} font-medium active:scale-[0.97]`
                            }`}
                            disabled={childRsvpPending}
                            onClick={() => !isActive && onChildRsvp(child.id, status)}
                          >
                            {isActive ? <Check className="h-3 w-3" /> : icon}
                            <span className="truncate">{label}</span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
