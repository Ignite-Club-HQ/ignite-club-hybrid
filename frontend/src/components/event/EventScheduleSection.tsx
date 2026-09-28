import { Calendar, Clock, Repeat } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  EventRecurrenceFields,
  EventSectionHeader,
  type EventRecurrencePattern,
} from "@/components/event/EventFormShared";

type EventScheduleSectionProps = {
  isOpen: boolean;
  onToggle: () => void;
  isFromMiniLeague: boolean;
  eventDateTime: string;
  onEventDateTimeChange: (value: string) => void;
  endTimeMode: "end_time" | "duration";
  onEndTimeModeChange: (mode: "end_time" | "duration") => void;
  duration: string;
  onDurationChange: (value: string) => void;
  endTime: string;
  onEndTimeChange: (value: string) => void;
  isRecurring: boolean;
  onIsRecurringChange: (value: boolean) => void;
  recurrencePattern: EventRecurrencePattern;
  recurrenceDays: number[];
  recurrenceInterval: number;
  recurrenceEndDate: string;
  onRecurrencePatternChange: (pattern: EventRecurrencePattern) => void;
  onToggleRecurrenceDay: (day: number) => void;
  onRecurrenceIntervalChange: (interval: number) => void;
  onRecurrenceEndDateChange: (endDate: string) => void;
};

export function EventScheduleSection({
  isOpen,
  onToggle,
  isFromMiniLeague,
  eventDateTime,
  onEventDateTimeChange,
  endTimeMode,
  onEndTimeModeChange,
  duration,
  onDurationChange,
  endTime,
  onEndTimeChange,
  isRecurring,
  onIsRecurringChange,
  recurrencePattern,
  recurrenceDays,
  recurrenceInterval,
  recurrenceEndDate,
  onRecurrencePatternChange,
  onToggleRecurrenceDay,
  onRecurrenceIntervalChange,
  onRecurrenceEndDateChange,
}: EventScheduleSectionProps) {
  return (
    <Card>
      <Collapsible open={isOpen}>
        <EventSectionHeader
          icon={Calendar}
          title="Date & Time"
          isOpen={isOpen}
          onClick={onToggle}
          badge="Required"
        />
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4 px-4 space-y-4">
            {/* Combined Date & Time input */}
            <div className="space-y-2">
              <Label htmlFor="datetime">Date & Time</Label>
              <Input
                id="datetime"
                type="datetime-local"
                value={eventDateTime}
                onChange={(e) => onEventDateTimeChange(e.target.value)}
                className="w-full h-12"
              />
            </div>

            {/* End Time / Duration */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <Label className="text-sm font-medium">End Time</Label>
                <span className="text-xs text-muted-foreground">(optional)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onEndTimeModeChange("duration")}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full border transition-colors",
                    endTimeMode === "duration"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                  )}
                >
                  Duration
                </button>
                <button
                  type="button"
                  onClick={() => onEndTimeModeChange("end_time")}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full border transition-colors",
                    endTimeMode === "end_time"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                  )}
                >
                  End Time
                </button>
              </div>
              {endTimeMode === "duration" ? (
                <div className="relative">
                  <Input
                    type="number"
                    min={5}
                    max={720}
                    step={5}
                    placeholder="e.g. 60"
                    value={duration}
                    onChange={(e) => onDurationChange(e.target.value)}
                    className="h-12 pr-16"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">mins</span>
                  {endTime && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Ends at {endTime}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(e) => onEndTimeChange(e.target.value)}
                    className="h-12"
                  />
                  {duration && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Duration: {duration} mins
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2">
                <Repeat className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {isFromMiniLeague ? "Repeat this match day" : "Repeat this event"}
                </span>
              </div>
              <Switch
                checked={isRecurring}
                onCheckedChange={onIsRecurringChange}
              />
            </div>

            {isRecurring && (
              <EventRecurrenceFields
                pattern={recurrencePattern}
                days={recurrenceDays}
                interval={recurrenceInterval}
                endDate={recurrenceEndDate}
                startDate={eventDateTime}
                onPatternChange={onRecurrencePatternChange}
                onToggleDay={onToggleRecurrenceDay}
                onIntervalChange={onRecurrenceIntervalChange}
                onEndDateChange={onRecurrenceEndDateChange}
              />
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
