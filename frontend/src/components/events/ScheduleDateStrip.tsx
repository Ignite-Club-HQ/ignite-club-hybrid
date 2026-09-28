import { useMemo, useRef, useEffect } from "react";
import { addDays, format, isSameDay, startOfDay, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScheduleDateStripProps {
  /** Currently selected day (null = no day filter, default upcoming/past view). */
  selectedDate: Date | null;
  onSelectDate: (date: Date | null) => void;
  /** Set of YYYY-MM-DD keys that have at least one event. */
  daysWithEvents: Set<string>;
  /** Anchor week — strip shows 7 days starting from start-of-week of this date. */
  weekAnchor: Date;
  onShiftWeek: (deltaDays: number) => void;
}

const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Horizontal Mon–Sun date strip for the Schedule page. Tap a day to filter
 * the list to just that day; tap again to clear. Days that have at least
 * one scheduled event get a small dot indicator.
 */
export function ScheduleDateStrip({
  selectedDate,
  onSelectDate,
  daysWithEvents,
  weekAnchor,
  onShiftWeek,
}: ScheduleDateStripProps) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const weekStart = useMemo(
    () => startOfWeek(weekAnchor, { weekStartsOn: 1 }),
    [weekAnchor],
  );
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep selected day visible if user shifts weeks
  useEffect(() => {
    if (!selectedDate || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLButtonElement>(
      `[data-day-key="${dayKey(selectedDate)}"]`,
    );
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [selectedDate, weekStart]);

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onShiftWeek(-7)}
        className="shrink-0 h-9 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:scale-95 transition"
        aria-label="Previous week"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div
        ref={scrollRef}
        className="flex flex-1 items-center justify-between gap-1 overflow-x-auto scrollbar-hide"
      >
        {days.map((d) => {
          const isSelected = selectedDate ? isSameDay(d, selectedDate) : false;
          const isToday = isSameDay(d, today);
          const hasEvent = daysWithEvents.has(dayKey(d));
          return (
            <button
              key={dayKey(d)}
              type="button"
              data-day-key={dayKey(d)}
              onClick={() => onSelectDate(isSelected ? null : d)}
              aria-pressed={isSelected}
              aria-label={`${format(d, "EEEE d MMMM")}${hasEvent ? ", has events" : ""}`}
              className={cn(
                "flex flex-1 min-w-[40px] flex-col items-center gap-0.5 rounded-lg py-1.5 px-1 transition-colors",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : isToday
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              <span className="text-[10px] font-medium uppercase tracking-wide">
                {format(d, "EEE")}
              </span>
              <span className="text-sm font-semibold leading-none">
                {format(d, "d")}
              </span>
              <span
                className={cn(
                  "h-1 w-1 rounded-full",
                  hasEvent
                    ? isSelected
                      ? "bg-primary-foreground"
                      : "bg-primary"
                    : "bg-transparent",
                )}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => onShiftWeek(7)}
        className="shrink-0 h-9 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:scale-95 transition"
        aria-label="Next week"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
