import type { ReactNode } from "react";
import { Calendar, Repeat } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  EventRecurrenceFields,
  EventSectionHeader,
  type EventRecurrencePattern,
} from "@/components/event/EventFormShared";

type EventEditScheduleSectionProps = {
  isOpen: boolean;
  onToggle: () => void;
  eventDateTime: string;
  onEventDateTimeChange: (value: string) => void;
  isRecurring: boolean;
  enableRecurring: boolean;
  onEnableRecurringChange: (value: boolean) => void;
  recurrencePattern: EventRecurrencePattern;
  recurrenceDays: number[];
  recurrenceInterval: number;
  recurrenceEndDate: string;
  onRecurrencePatternChange: (pattern: EventRecurrencePattern) => void;
  onToggleRecurrenceDay: (day: number) => void;
  onRecurrenceIntervalChange: (interval: number) => void;
  onRecurrenceEndDateChange: (endDate: string) => void;
  recurringSeriesContent?: ReactNode;
};

export function EventEditScheduleSection({
  isOpen,
  onToggle,
  eventDateTime,
  onEventDateTimeChange,
  isRecurring,
  enableRecurring,
  onEnableRecurringChange,
  recurrencePattern,
  recurrenceDays,
  recurrenceInterval,
  recurrenceEndDate,
  onRecurrencePatternChange,
  onToggleRecurrenceDay,
  onRecurrenceIntervalChange,
  onRecurrenceEndDateChange,
  recurringSeriesContent,
}: EventEditScheduleSectionProps) {
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
            <div className="space-y-2">
              <Label htmlFor="datetime">Date & Time</Label>
              <Input
                id="datetime"
                type="datetime-local"
                value={eventDateTime}
                onChange={(event) => onEventDateTimeChange(event.target.value)}
                className="w-full h-12"
              />
            </div>

            {!isRecurring && (
              <>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2">
                    <Repeat className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Convert to recurring series</span>
                  </div>
                  <Switch
                    checked={enableRecurring}
                    onCheckedChange={onEnableRecurringChange}
                  />
                </div>

                {enableRecurring && (
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
              </>
            )}

            {isRecurring ? recurringSeriesContent : null}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
