/**
 * Utilities for the Expression of Interest (EOI) system.
 */

export const EOI_STATUS_LABELS: Record<string, string> = {
  invited: "Invited",
  submitted: "Submitted",
  preferences_completed: "Preferences complete",
  allocated: "Allocated",
  confirmed: "Confirmed",
  registered: "Registered",
  withdrawn: "Withdrawn",
};

export const EOI_STATUS_ORDER = [
  "invited",
  "submitted",
  "preferences_completed",
  "allocated",
  "confirmed",
  "registered",
] as const;

export function slugifyClubName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildPublicEoiUrl(clubName: string, seasonSlug: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/eoi/${slugifyClubName(clubName)}/${seasonSlug}`;
}

export function calculateAgeGroup(dob: string | null | undefined): string | null {
  if (!dob) return null;
  const year = new Date(dob).getFullYear();
  const thisYear = new Date().getFullYear();
  const age = thisYear - year;
  if (Number.isNaN(age) || age < 3 || age > 100) return null;
  if (age <= 18) return `U${age + 1}`;
  return "Senior";
}

export const WEEKDAYS: { value: string; label: string; short: string }[] = [
  { value: "mon", label: "Monday", short: "Mon" },
  { value: "tue", label: "Tuesday", short: "Tue" },
  { value: "wed", label: "Wednesday", short: "Wed" },
  { value: "thu", label: "Thursday", short: "Thu" },
  { value: "fri", label: "Friday", short: "Fri" },
  { value: "sat", label: "Saturday", short: "Sat" },
  { value: "sun", label: "Sunday", short: "Sun" },
];
