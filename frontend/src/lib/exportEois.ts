import { format } from "date-fns";
import type { EoiSubmission } from "@/hooks/useEoiAdmin";
import { EOI_STATUS_LABELS, calculateAgeGroup } from "@/lib/eoiUtils";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function exportEoisCSV(
  rows: EoiSubmission[],
  seasonNameById: Map<string, string>,
  clubName: string,
) {
  const header = [
    "Player",
    "DOB",
    "Age group",
    "Gender",
    "Parent",
    "Email",
    "Mobile",
    "Season",
    "Status",
    "Returning",
    "Skill (1-5)",
    "Position",
    "Preferred teammates",
    "Training days",
    "Game days",
    "Source",
    "Submitted",
    "Notes",
  ].join(",");

  const lines = rows.map((r) =>
    [
      r.player_name,
      r.player_dob ?? "",
      r.age_group ?? calculateAgeGroup(r.player_dob) ?? "",
      r.player_gender ?? "",
      r.parent_name,
      r.parent_email,
      r.parent_mobile ?? "",
      seasonNameById.get(r.season_id) ?? "",
      EOI_STATUS_LABELS[r.status] ?? r.status,
      r.returning_player ? "Yes" : "No",
      r.skill_level ?? "",
      r.preferred_position ?? "",
      r.preferred_teammates ?? "",
      (r.training_days ?? []).join("; "),
      (r.game_days ?? []).join("; "),
      r.source,
      r.submitted_at ? format(new Date(r.submitted_at), "yyyy-MM-dd HH:mm") : "",
      r.notes ?? "",
    ]
      .map(csvEscape)
      .join(","),
  );

  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const stamp = format(new Date(), "yyyyMMdd");
  link.download = `eois-${clubName.replace(/\s+/g, "-").toLowerCase()}-${stamp}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
