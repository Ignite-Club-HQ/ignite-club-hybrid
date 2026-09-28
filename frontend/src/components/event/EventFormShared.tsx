import type { LucideIcon } from "lucide-react";
import { ChevronDown, Plus, X } from "lucide-react";
import { AddressAutocomplete, type SavedLocation } from "@/components/AddressAutocomplete";
import { DutyMemberSelect } from "@/components/DutyMemberSelect";
import { GoogleMapEmbed } from "@/components/GoogleMapEmbed";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type EventRecurrencePattern = "daily" | "weekly" | "biweekly" | "monthly";

export const EVENT_RECURRENCE_DAYS = [
  { value: 0, label: "S" },
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
] as const;

type EventSectionHeaderProps = {
  icon: LucideIcon;
  title: string;
  isOpen: boolean;
  onClick: () => void;
  badge?: string;
};

export function EventSectionHeader({ icon: Icon, title, isOpen, onClick, badge }: EventSectionHeaderProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onClick();
      }}
      className="flex items-center justify-between w-full p-4 text-left hover:bg-muted/50 transition-colors rounded-lg cursor-pointer select-none"
    >
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <span className="font-medium">{title}</span>
        {badge && <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{badge}</span>}
      </div>
      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")} />
    </div>
  );
}

type EventRecurrenceFieldsProps = {
  pattern: EventRecurrencePattern;
  days: number[];
  interval: number;
  endDate: string;
  startDate: string;
  onPatternChange: (pattern: EventRecurrencePattern) => void;
  onToggleDay: (day: number) => void;
  onIntervalChange: (interval: number) => void;
  onEndDateChange: (endDate: string) => void;
};

export function EventRecurrenceFields({
  pattern,
  days,
  interval,
  endDate,
  startDate,
  onPatternChange,
  onToggleDay,
  onIntervalChange,
  onEndDateChange,
}: EventRecurrenceFieldsProps) {
  return (
    <div className="space-y-4 p-3 rounded-lg border border-dashed">
      <div className="space-y-2">
        <Label>Frequency</Label>
        <Select value={pattern} onValueChange={(value) => onPatternChange(value as EventRecurrencePattern)}>
          <SelectTrigger className="h-12 text-base">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4}>
            <SelectItem value="daily" className="py-3 text-base">Daily</SelectItem>
            <SelectItem value="weekly" className="py-3 text-base">Weekly</SelectItem>
            <SelectItem value="biweekly" className="py-3 text-base">Bi-weekly</SelectItem>
            <SelectItem value="monthly" className="py-3 text-base">Monthly</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {pattern === "weekly" && (
        <div className="space-y-2">
          <Label>Repeat on</Label>
          <div className="flex gap-1">
            {EVENT_RECURRENCE_DAYS.map((day) => (
              <button
                key={day.value}
                type="button"
                onClick={() => onToggleDay(day.value)}
                className={cn(
                  "w-9 h-9 rounded-full text-sm font-medium transition-colors",
                  days.includes(day.value) ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80",
                )}
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Every</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={12}
              value={interval}
              onChange={(event) => onIntervalChange(parseInt(event.target.value) || 1)}
              className="w-16"
            />
            <span className="text-sm text-muted-foreground">
              {pattern === "daily" && "day(s)"}
              {pattern === "weekly" && "week(s)"}
              {pattern === "biweekly" && "period(s)"}
              {pattern === "monthly" && "month(s)"}
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="endDate">Until</Label>
          <Input
            id="endDate"
            type="date"
            value={endDate}
            onChange={(event) => onEndDateChange(event.target.value)}
            min={startDate ? startDate.split("T")[0] : undefined}
          />
        </div>
      </div>
    </div>
  );
}

export type EventDuty = {
  id?: string;
  name: string;
  assignedTo: string | null;
};

type EventDutyMember = {
  id: string;
  display_name: string;
  avatar_url?: string | null;
};

type EventDutyFieldsProps = {
  duties: EventDuty[];
  members: EventDutyMember[];
  newDutyName: string;
  onNewDutyNameChange: (name: string) => void;
  onAddDuty: () => void;
  onRemoveDuty: (duty: EventDuty) => void;
  onAssignDuty: (duty: EventDuty, userId: string | null) => void;
  onQuickAddDuty: (name: string) => void;
};

const QUICK_DUTIES = ["BBQ", "Scorer", "First Aid", "Oranges", "Snacks", "Subs Manager", "Water Duty", "Set Up", "Pack Up"];

export function EventDutyFields({
  duties,
  members,
  newDutyName,
  onNewDutyNameChange,
  onAddDuty,
  onRemoveDuty,
  onAssignDuty,
  onQuickAddDuty,
}: EventDutyFieldsProps) {
  return (
    <CardContent className="pt-0 pb-4 px-4 space-y-4">
      <p className="text-sm text-muted-foreground">
        Add duties like BBQ, scorer, or first aid for volunteers to sign up.
      </p>
      <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
        <span className="text-lg">🔥</span>
        <p className="text-sm text-foreground">
          <span className="font-medium">Points:</span> Volunteers earn <span className="font-semibold text-primary">10 points</span> for each completed duty (Pro clubs only). Points are awarded 24 hours after the game ends.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="e.g., BBQ duty, Scorer, First Aid"
          value={newDutyName}
          onChange={(event) => onNewDutyNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAddDuty();
            }
          }}
          className="flex-1 h-12"
        />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-12 w-12 shrink-0"
          onClick={onAddDuty}
          disabled={!newDutyName.trim()}
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      {duties.length > 0 && (
        <div className="space-y-3">
          {duties.map((duty, index) => (
            <div key={duty.id || index} className="p-3 rounded-lg bg-muted/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{duty.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => onRemoveDuty(duty)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <DutyMemberSelect
                value={duty.assignedTo}
                onValueChange={(value) => onAssignDuty(duty, value)}
                members={members}
                dutyName={duty.name}
              />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Quick add:</Label>
        <div className="flex flex-wrap gap-2">
          {QUICK_DUTIES.map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => onQuickAddDuty(suggestion)}
              disabled={duties.some((duty) => duty.name === suggestion)}
            >
              {suggestion}
            </Button>
          ))}
        </div>
      </div>
    </CardContent>
  );
}

type EventLocationFieldsProps = {
  value: string;
  savedLocations?: SavedLocation[];
  onChange: (value: string) => void;
  mapWrapperClassName?: string;
};

export function EventLocationFields({ value, savedLocations, onChange, mapWrapperClassName }: EventLocationFieldsProps) {
  return (
    <>
      <AddressAutocomplete
        value={value}
        onChange={onChange}
        onSelect={(address) => {
          const fullAddress = [address.address, address.suburb, address.state, address.postcode]
            .filter(Boolean)
            .join(", ");
          onChange(fullAddress || address.address);
        }}
        placeholder="Search for address..."
        savedLocations={savedLocations}
      />
      {value && (mapWrapperClassName ? (
        <div className={mapWrapperClassName}><GoogleMapEmbed address={value} /></div>
      ) : <GoogleMapEmbed address={value} />)}
    </>
  );
}
