import { useEffect, useState } from "react";
import { format, addHours, setHours, setMinutes, setSeconds, addDays, nextMonday } from "date-fns";
import { Calendar as CalendarIcon, Clock, Loader2 } from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ScheduleTarget,
  ScheduledMessageRow,
  ScheduledMessageRecurrence,
  useCreateScheduledMessage,
  useUpdateScheduledMessage,
} from "@/hooks/useScheduledMessages";
import { ScheduleImageField } from "./ScheduleImageField";
import { ScheduleRecurrenceField } from "./ScheduleRecurrenceField";
import { useScheduleProAccess } from "@/hooks/useScheduleProAccess";
import { ProFeatureLock } from "@/components/subscription/ProFeatureLock";

interface ScheduleMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ScheduleTarget;
  /** Pre-fill from current composer state. Optional. */
  initialText?: string;
  initialImageUrl?: string | null;
  /** When provided, the dialog edits this existing scheduled row instead of creating a new one. */
  editingRow?: ScheduledMessageRow | null;
  /** Called after successful save with the chosen Date — useful so the composer can clear itself. */
  onScheduled?: () => void;
}

const QUICK_PRESETS: Array<{ label: string; build: () => Date }> = [
  { label: "In 1 hour", build: () => addHours(new Date(), 1) },
  {
    label: "Tomorrow 9am",
    build: () => setSeconds(setMinutes(setHours(addDays(new Date(), 1), 9), 0), 0),
  },
  {
    label: "Monday 9am",
    build: () => {
      const d = nextMonday(new Date());
      return setSeconds(setMinutes(setHours(d, 9), 0), 0);
    },
  },
];

function roundToNext5Min(d: Date): Date {
  const ms = 5 * 60 * 1000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

export function localTimezoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
  } catch {
    return "local time";
  }
}

export function ScheduleMessageDialog({
  open,
  onOpenChange,
  target,
  initialText = "",
  initialImageUrl = null,
  editingRow = null,
  onScheduled,
}: ScheduleMessageDialogProps) {
  const isEditing = !!editingRow;
  const create = useCreateScheduledMessage();
  const update = useUpdateScheduledMessage();
  const isSaving = create.isPending || update.isPending;

  const [text, setText] = useState(initialText);
  const [imageUrl, setImageUrl] = useState<string | null>(initialImageUrl);
  const [recurrence, setRecurrence] = useState<ScheduledMessageRecurrence>("none");
  const [recurrenceUntil, setRecurrenceUntil] = useState<Date | null>(null);

  // Default scheduled time: next 5-min boundary at least 5 minutes from now
  const defaultDate = roundToNext5Min(addHours(new Date(), 0.1));
  const [date, setDate] = useState<Date>(defaultDate);
  const [timeStr, setTimeStr] = useState<string>(format(defaultDate, "HH:mm"));
  const [activePreset, setActivePreset] = useState<string | null>(null);

  // Reset state whenever the dialog opens (or target/editingRow changes)
  useEffect(() => {
    if (!open) return;
    if (editingRow) {
      const d = new Date(editingRow.scheduled_for);
      setText(editingRow.text || "");
      setImageUrl(editingRow.image_url || null);
      setDate(d);
      setTimeStr(format(d, "HH:mm"));
      setRecurrence(editingRow.recurrence || "none");
      setRecurrenceUntil(
        editingRow.recurrence_until ? new Date(editingRow.recurrence_until) : null,
      );
    } else {
      setText(initialText);
      setImageUrl(initialImageUrl);
      const d = roundToNext5Min(addHours(new Date(), 0.1));
      setDate(d);
      setTimeStr(format(d, "HH:mm"));
      setRecurrence("none");
      setRecurrenceUntil(null);
    }
    setActivePreset(null);
  }, [open, editingRow, initialText, initialImageUrl]);

  const buildScheduledDate = (): Date | null => {
    const [hh, mm] = timeStr.split(":").map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    const out = new Date(date);
    out.setHours(hh, mm, 0, 0);
    return out;
  };

  const scheduledDate = buildScheduledDate();
  const minMs = Date.now() + 60 * 1000; // must be at least 1 min in the future
  const isInFuture = scheduledDate ? scheduledDate.getTime() > minMs : false;
  const hasContent = text.trim().length > 0 || !!imageUrl;
  const recurrenceEndOk = recurrence === "none" || !!recurrenceUntil;
  const canSave = hasContent && isInFuture && recurrenceEndOk && !isSaving;

  const applyPreset = (label: string, preset: () => Date) => {
    const d = roundToNext5Min(preset());
    setDate(d);
    setTimeStr(format(d, "HH:mm"));
    setActivePreset(label);
  };

  const handleSave = async () => {
    const when = buildScheduledDate();
    if (!when) {
      toast.error("Please choose a valid time");
      return;
    }
    if (when.getTime() <= minMs) {
      toast.error("Please choose a time at least 1 minute in the future");
      return;
    }
    if (!hasContent) {
      toast.error("Add a message or image first");
      return;
    }
    if (recurrence !== "none" && !recurrenceUntil) {
      toast.error("Choose an end date for the recurring schedule");
      return;
    }

    try {
      if (isEditing && editingRow) {
        await update.mutateAsync({
          id: editingRow.id,
          text: text.trim(),
          image_url: imageUrl,
          scheduled_for: when,
          recurrence,
          recurrence_until: recurrence === "none" ? null : recurrenceUntil,
        });
        toast.success("Scheduled message updated");
      } else {
        await create.mutateAsync({
          ...target,
          text: text.trim(),
          image_url: imageUrl,
          scheduled_for: when,
          recurrence,
          recurrence_until: recurrence === "none" ? null : recurrenceUntil,
        });
        toast.success(
          recurrence === "none"
            ? `Message scheduled for ${format(when, "PPp")}`
            : `Recurring message scheduled, starting ${format(when, "PPp")}`,
        );
      }
      onScheduled?.();
      onOpenChange(false);
    } catch (err: any) {
      console.error("[schedule-dialog] save failed", err);
      toast.error(err?.message || "Failed to schedule message");
    }
  };

  // Image upload target (so attachments land in the same club/team folder).
  const uploadTarget = {
    clubId: target.club_id ?? undefined,
    teamId: target.team_id ?? undefined,
  };

  const { hasAccess: hasProAccess, isLoading: proLoading } = useScheduleProAccess(target);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6 gap-3 sm:gap-4">
        <ResponsiveDialogHeader className="space-y-1.5 text-left px-0 pt-2 sm:pt-0">
          <ResponsiveDialogTitle className="text-base sm:text-xl">
            {isEditing ? "Edit scheduled message" : "Schedule message"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="text-xs sm:text-sm">
            {isEditing
              ? `Times shown in your local timezone (${localTimezoneLabel()}).`
              : `Pick when to send. Times shown in your local timezone (${localTimezoneLabel()}).`}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {!proLoading && !hasProAccess ? (
          <ProFeatureLock
            title="Scheduling is a Pro feature"
            description="Schedule messages to send later. Upgrade your club to Pro to unlock."
            clubId={target.club_id ?? null}
            showUpgradeButton={!!target.club_id}
          />
        ) : (
        <div className="space-y-3 sm:space-y-4">
          <div className="space-y-2">
            <Label htmlFor="schedule-text">Message</Label>
            <Textarea
              id="schedule-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write your message…"
              rows={4}
              className="resize-none"
            />
          </div>

          <ScheduleImageField
            value={imageUrl}
            onChange={setImageUrl}
            uploadTarget={uploadTarget}
            disabled={isSaving}
          />

          <div className="grid grid-cols-3 gap-2">
            {QUICK_PRESETS.map((p) => {
              const isActive = activePreset === p.label;
              return (
                <Button
                  key={p.label}
                  type="button"
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  onClick={() => applyPreset(p.label, p.build)}
                  className={cn(
                    "h-9 px-2 text-xs sm:text-sm whitespace-nowrap",
                    isActive && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                  )}
                >
                  {p.label}
                </Button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn("w-full justify-start text-left font-normal")}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(date, "MMM d, yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => { if (d) { setDate(d); setActivePreset(null); } }}
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="schedule-time">Time</Label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="schedule-time"
                  type="time"
                  value={timeStr}
                  onChange={(e) => { setTimeStr(e.target.value); setActivePreset(null); }}
                  className={cn(
                    "pl-9",
                    scheduledDate && !isInFuture && "border-destructive focus-visible:ring-destructive",
                  )}
                />
              </div>
            </div>
          </div>

          <ScheduleRecurrenceField
            recurrence={recurrence}
            onRecurrenceChange={setRecurrence}
            endDate={recurrenceUntil}
            onEndDateChange={setRecurrenceUntil}
            disabled={isSaving}
          />

          {scheduledDate && (
            <p
              className={cn(
                "text-xs",
                isInFuture ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {isInFuture
                ? `Will send on ${format(scheduledDate, "EEEE, MMM d 'at' h:mm a")}`
                : "Choose a time in the future"}
            </p>
          )}
        </div>
        )}

        <ResponsiveDialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:gap-2 px-0 pb-2 sm:pb-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            className="w-full sm:w-auto"
          >
            {!proLoading && !hasProAccess ? "Close" : "Cancel"}
          </Button>
          {(proLoading || hasProAccess) && (
            <Button onClick={handleSave} disabled={!canSave} className="w-full sm:w-auto">
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save changes" : "Schedule"}
            </Button>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
