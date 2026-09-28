interface EnrolmentExportRow {
  className: string;
  memberName: string;
  type: string;
  status: string;
  waitlistPosition: number | null;
  enrolledDate: string;
}

export function exportEnrolmentsCSV(
  rows: EnrolmentExportRow[],
  termName: string
) {
  const header = "Class,Name,Type,Status,Waitlist #,Enrolled Date";
  const csvRows = rows.map((r) =>
    [
      `"${r.className}"`,
      `"${r.memberName}"`,
      r.type,
      r.status,
      r.waitlistPosition ?? "",
      r.enrolledDate,
    ].join(",")
  );
  const csv = [header, ...csvRows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `enrolments-${termName.replace(/\s+/g, "-").toLowerCase()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
