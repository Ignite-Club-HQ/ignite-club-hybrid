import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock, Users, CalendarDays } from "lucide-react";

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface ClassFieldsSectionProps {
  classDay: string;
  setClassDay: (day: string) => void;
  classTime: string;
  setClassTime: (time: string) => void;
  classDuration: number | null;
  setClassDuration: (duration: number | null) => void;
  classCapacity: number | null;
  setClassCapacity: (capacity: number | null) => void;
}

export function ClassFieldsSection({
  classDay, setClassDay,
  classTime, setClassTime,
  classDuration, setClassDuration,
  classCapacity, setClassCapacity,
}: ClassFieldsSectionProps) {
  return (
    <div className="space-y-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-center gap-2 mb-1">
        <CalendarDays className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold text-primary">Class Schedule</p>
      </div>

      {/* Day */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Day of Week <span className="text-destructive">*</span></Label>
        <Select value={classDay} onValueChange={setClassDay}>
          <SelectTrigger className="h-11 bg-background">
            <SelectValue placeholder="Select a day" />
          </SelectTrigger>
          <SelectContent className="bg-popover">
            {DAYS_OF_WEEK.map((day) => (
              <SelectItem key={day} value={day}>{day}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Time + Duration row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-sm font-medium flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            Start Time
          </Label>
          <Input
            type="time"
            value={classTime}
            onChange={(e) => setClassTime(e.target.value)}
            className="h-11 bg-background"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Duration (mins)</Label>
          <Input
            type="number"
            min={15}
            max={240}
            step={15}
            placeholder="60"
            value={classDuration ?? ""}
            onChange={(e) => setClassDuration(e.target.value ? Number(e.target.value) : null)}
            className="h-11 bg-background"
          />
        </div>
      </div>

      {/* Capacity */}
      <div className="space-y-2">
        <Label className="text-sm font-medium flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          Max Capacity
        </Label>
        <Input
          type="number"
          min={1}
          max={200}
          placeholder="e.g., 20"
          value={classCapacity ?? ""}
          onChange={(e) => setClassCapacity(e.target.value ? Number(e.target.value) : null)}
          className="h-11 bg-background"
        />
        <p className="text-xs text-muted-foreground">Leave empty for unlimited</p>
      </div>
    </div>
  );
}
