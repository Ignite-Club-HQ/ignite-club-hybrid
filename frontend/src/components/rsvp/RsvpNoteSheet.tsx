import { useEffect, useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

export const RSVP_NOTE_MAX = 500;

interface RsvpNoteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Who the note is for, e.g. "You" or a child's name. */
  subjectName: string;
  /** Current status label shown for context, e.g. "Not Going". */
  statusLabel?: string | null;
  initialNote?: string | null;
  /** Persist the note. `null` clears it. */
  onSave: (note: string | null) => Promise<void> | void;
}

/**
 * Optional follow-up note for an RSVP (Heja-style). The RSVP itself is always
 * one tap — this sheet only opens when someone chooses to explain.
 */
export function RsvpNoteSheet({
  open,
  onOpenChange,
  subjectName,
  statusLabel,
  initialNote,
  onSave,
}: RsvpNoteSheetProps) {
  const [value, setValue] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValue(initialNote ?? "");
  }, [open, initialNote]);

  const handleSave = async () => {
    const trimmed = value.trim();
    setSaving(true);
    try {
      await onSave(trimmed ? trimmed.slice(0, RSVP_NOTE_MAX) : null);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const remaining = RSVP_NOTE_MAX - value.length;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Note for organiser
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {subjectName}
            {statusLabel ? ` · ${statusLabel}` : ""} — optional, only organisers and
            admins see this.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="px-4 sm:px-0 space-y-2">
          <Textarea
            autoFocus
            rows={4}
            maxLength={RSVP_NOTE_MAX}
            placeholder="e.g. Away at a wedding, arriving 15 minutes late…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          {remaining <= 100 && (
            <p className="text-xs text-muted-foreground text-right">
              {remaining} characters left
            </p>
          )}
        </div>

        <ResponsiveDialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {value.trim() ? "Save note" : initialNote ? "Remove note" : "Save"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
