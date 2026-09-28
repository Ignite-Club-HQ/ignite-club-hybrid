import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RSVP_AUDIENCE_OPTIONS,
  type RsvpAudience,
} from "@/lib/rsvpAudience";

interface Props {
  value: RsvpAudience | null;
  onChange: (next: RsvpAudience | null) => void;
  /**
   * Optional. When provided, the "Use team default" option is shown and the
   * label of that option includes the resolved team default for clarity.
   */
  teamDefault?: RsvpAudience | null;
  /** Render without a wrapping label/help text (caller controls layout). */
  bare?: boolean;
  id?: string;
}

const labelFor = (v: RsvpAudience) =>
  RSVP_AUDIENCE_OPTIONS.find((o) => o.value === v)?.label ?? v;

/**
 * Reusable RSVP audience picker. When `teamDefault` is supplied the select
 * also exposes a "Use team default" option that maps to `null`.
 */
export function RsvpAudienceSelect({
  value,
  onChange,
  teamDefault,
  bare,
  id = "rsvp-audience",
}: Props) {
  const showDefault = teamDefault !== undefined;
  const selectValue = value === null ? "__default__" : value;

  const control = (
    <Select
      value={selectValue}
      onValueChange={(v) =>
        onChange(v === "__default__" ? null : (v as RsvpAudience))
      }
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Select audience" />
      </SelectTrigger>
      <SelectContent>
        {showDefault && (
          <SelectItem value="__default__">
            Use team default
            {teamDefault ? ` (${labelFor(teamDefault)})` : ""}
          </SelectItem>
        )}
        {RSVP_AUDIENCE_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (bare) return control;

  const helper =
    value === null && teamDefault
      ? `Inherits the team default (${labelFor(teamDefault)}).`
      : RSVP_AUDIENCE_OPTIONS.find((o) => o.value === value)?.description;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>RSVP audience</Label>
      {control}
      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
}
