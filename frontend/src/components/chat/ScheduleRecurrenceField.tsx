import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ScheduledMessageRecurrence } from "@/hooks/useScheduledMessages";

interface ScheduleRecurrenceFieldProps {
  recurrence: ScheduledMessageRecurrence;
  onRecurrenceChange: (r: ScheduledMessageRecurrence) => void;
  endDate: Date | null;
  onEndDateChange: (d: Date | null) => void;
  disabled?: boolean;
}

const OPTIONS: Array<{ value: ScheduledMessageRecurrence; label: string }> = [
  { value: "none", label: "Don't repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];

export function ScheduleRecurrenceField({
  recurrence,
  onRecurrenceChange,
  endDate,
  onEndDateChange,
  disabled,
}: ScheduleRecurrenceFieldProps) {
  const showEnd = recurrence !== "none";

  return (
    <div className="space-y-2">
      <Label>Repeat</Label>
      <Select
        value={recurrence}
        onValueChange={(v) => onRecurrenceChange(v as ScheduledMessageRecurrence)}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[100000]">
          {OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showEnd && (
        <div className="space-y-2 pt-1">
          <Label className="text-xs text-muted-foreground">
            Stops repeating after <span className="text-destructive">*</span>
          </Label>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "flex-1 justify-start text-left font-normal",
                    !endDate && "border-destructive text-destructive",
                  )}
                  disabled={disabled}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {endDate ? format(endDate, "MMM d, yyyy") : "Choose end date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={endDate ?? undefined}
                  onSelect={(d) => onEndDateChange(d ?? null)}
                  disabled={(d) => {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    return d < today;
                  }}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            {endDate && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onEndDateChange(null)}
                disabled={disabled}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
