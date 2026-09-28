import { useCallback, useRef, useState } from "react";
import { Mail, Send, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CsvFileDropZone,
  CsvFormatGuide,
  CsvImportDialogFrame,
  CsvImportedFile,
  CsvImportIssue,
  CsvIssueSummary,
  CsvTemplateDownloadButton,
  CsvPreviewShell,
  downloadCsvTemplate,
} from "@/components/csv-import/CsvImportPresentation";
import { useToast } from "@/hooks/use-toast";
import { isValidEmail, parseCsvLine } from "@/lib/csv";

type TeamRole = "player" | "parent" | "coach" | "team_admin";

interface ParsedChild {
  name: string;
  yearOfBirth: number | null;
  shirtNumber: number | null;
}

interface ParsedMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  children: ParsedChild[];
}

interface MemberCSVImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultRole: TeamRole;
  onImport: (members: ParsedMember[]) => void;
}

const VALID_ROLES: TeamRole[] = ["player", "parent", "coach", "team_admin"];
const FORMAT_COLUMNS = [
  "name",
  "email",
  "role",
  "child1_name",
  "child1_yob",
  "child1_shirt",
  "child2_name",
  "child2_yob",
  "child2_shirt",
  "child3_name",
  "child3_yob",
  "child3_shirt",
];
function getRoleBadgeClass(role: TeamRole) {
  switch (role) {
    case "player": return "bg-amber-500/20 text-amber-600 border-amber-500/30";
    case "parent": return "bg-pink-500/20 text-pink-600 border-pink-500/30";
    case "coach": return "bg-emerald-500/20 text-emerald-600 border-emerald-500/30";
    case "team_admin": return "bg-blue-500/20 text-blue-600 border-blue-500/30";
  }
}

const TEMPLATE_CONTENT = `name,email,role,child1_name,child1_yob,child1_shirt,child2_name,child2_yob,child2_shirt,child3_name,child3_yob,child3_shirt
John Smith,redacted@example.invalid,player,,,,,,,,,
Jane Doe,redacted@example.invalid,parent,Tommy,2016,7,Sally,2018,10,,,
Mike Coach,redacted@example.invalid,coach,,,,,,,,,
Bob Parent,redacted@example.invalid,parent,Jimmy,2015,3,,,,,,
Lisa Guardian,,parent,Emma,2017,5,Jack,2019,8,Lily,2020,
Second Parent for Emma,redacted@example.invalid,parent,Emma,2017,5,,,,,,`;

export function MemberCSVImportDialog({
  open,
  onOpenChange,
  defaultRole,
  onImport,
}: MemberCSVImportDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsedMembers, setParsedMembers] = useState<ParsedMember[]>([]);
  const [errors, setErrors] = useState<CsvImportIssue[]>([]);

  const updateMemberField = (memberId: string, field: keyof ParsedMember, value: string) => {
    setParsedMembers(previous =>
      previous.map(member => member.id === memberId ? { ...member, [field]: value } : member),
    );
  };

  const isMemberValid = (member: ParsedMember) => (
    member.name.trim().length > 0 &&
    (!member.email || isValidEmail(member.email)) &&
    VALID_ROLES.includes(member.role)
  );
  const allMembersValid = parsedMembers.every(isMemberValid);
  const invalidCount = parsedMembers.filter(member => !isMemberValid(member)).length;

  const validateAndParse = (content: string): { members: ParsedMember[]; errors: CsvImportIssue[] } => {
    const lines = content.trim().split("\n").filter(line => line.trim());
    const members: ParsedMember[] = [];
    const parseErrors: CsvImportIssue[] = [];

    if (lines.length === 0) {
      parseErrors.push({ row: 0, message: "File is empty" });
      return { members, errors: parseErrors };
    }

    const firstLine = lines[0].toLowerCase();
    const hasHeader = firstLine.includes("name") || firstLine.includes("email");
    const startIndex = hasHeader ? 1 : 0;

    if (hasHeader) {
      const header = parseCsvLine(lines[0]).map(value => value.toLowerCase());
      const nameIndex = header.findIndex(value => value.includes("name"));

      if (nameIndex === -1) {
        parseErrors.push({ row: 1, message: "Missing 'name' column in header" });
      }
      if (nameIndex !== 0) {
        parseErrors.push({ row: 1, message: "Name should be the first column" });
      }
    }

    for (let index = startIndex; index < lines.length; index++) {
      const row = index + 1;
      const values = parseCsvLine(lines[index]);
      const name = values[0]?.trim();
      const email = values[1]?.trim() || "";
      const roleFromCsv = values[2]?.trim().toLowerCase() || "";
      const childValues = [
        [values[3]?.trim() || "", values[4]?.trim() || "", values[5]?.trim() || ""],
        [values[6]?.trim() || "", values[7]?.trim() || "", values[8]?.trim() || ""],
        [values[9]?.trim() || "", values[10]?.trim() || "", values[11]?.trim() || ""],
      ];

      if (!name) {
        parseErrors.push({ row, message: "Name is required" });
        continue;
      }
      if (name.length > 100) {
        parseErrors.push({ row, message: "Name must be less than 100 characters" });
        continue;
      }
      if (email && !isValidEmail(email)) {
        parseErrors.push({ row, message: `Invalid email format: "${email}"` });
        continue;
      }

      let role: TeamRole = defaultRole;
      if (roleFromCsv) {
        if (!VALID_ROLES.includes(roleFromCsv as TeamRole)) {
          parseErrors.push({ row, message: `Invalid role "${roleFromCsv}". Valid: player, parent, coach, team_admin` });
          continue;
        }
        role = roleFromCsv as TeamRole;
      }

      const children: ParsedChild[] = [];
      let invalidChild = false;
      childValues.forEach(([childName, childYob, childShirt], childIndex) => {
        if (!childName || invalidChild) return;
        const yearOfBirth = childYob ? parseInt(childYob) : null;
        if (childYob && (isNaN(yearOfBirth!) || yearOfBirth! < 1900 || yearOfBirth! > new Date().getFullYear())) {
          parseErrors.push({ row, message: `Invalid year of birth for child ${childIndex + 1}: "${childYob}"` });
          invalidChild = true;
          return;
        }
        children.push({
          name: childName,
          yearOfBirth,
          shirtNumber: childShirt ? parseInt(childShirt) : null,
        });
      });
      if (invalidChild) continue;
      if (children.length > 0 && role !== "parent") {
        parseErrors.push({ row, message: `Children specified but role is "${role}" (not parent)` });
        continue;
      }

      members.push({ id: crypto.randomUUID(), name, email, role, children });
    }

    const emailCounts = new Map<string, number>();
    members.forEach(member => {
      if (member.email) {
        const email = member.email.toLowerCase();
        emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
      }
    });
    emailCounts.forEach((count, email) => {
      if (count > 1) parseErrors.push({ row: 0, message: `Duplicate email: ${email} (${count} times)` });
    });

    return { members, errors: parseErrors };
  };

  const processFile = useCallback((selectedFile: File) => {
    if (!selectedFile.name.toLowerCase().endsWith(".csv")) {
      toast({ title: "Invalid file", description: "Please select a CSV file", variant: "destructive" });
      return;
    }

    const reader = new FileReader();
    reader.onload = event => {
      const content = event.target?.result as string;
      if (!content) return;
      const { members, errors: parseErrors } = validateAndParse(content);
      setFile(selectedFile);
      setParsedMembers(members);
      setErrors(parseErrors);
    };
    reader.readAsText(selectedFile);
  }, [toast, defaultRole]);

  const handleClear = () => {
    setFile(null);
    setParsedMembers([]);
    setErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleImport = () => {
    if (parsedMembers.length === 0) return;
    onImport(parsedMembers);
    handleClear();
    onOpenChange(false);
  };

  const hasBlockingErrors = errors.some(error => error.row > 0);

  return (
    <CsvImportDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Import Members"
      description="Upload a CSV file to bulk import team members"
    >
      <div className="flex-1 overflow-y-auto space-y-4 px-1">
        <CsvFormatGuide
          columns={FORMAT_COLUMNS}
          onDownloadTemplate={() => downloadCsvTemplate(TEMPLATE_CONTENT, "team_members_template.csv")}
        >
          <p><strong>name:</strong> Required - parent/member&apos;s full name</p>
          <p><strong>email:</strong> Optional - for sending invites</p>
          <p><strong>role:</strong> Optional - player, parent, coach, or team_admin</p>
          <p><strong>child1_name, child1_yob, child1_shirt:</strong> First child&apos;s name, year of birth, and shirt number</p>
          <p><strong>child2_name, child2_yob, child2_shirt:</strong> Second child (optional)</p>
          <p><strong>child3_name, child3_yob, child3_shirt:</strong> Third child (optional)</p>
          <p className="text-primary/80 mt-1">&#x1F4A1; Multiple parents can reference the same child by using identical name + year of birth</p>
        </CsvFormatGuide>

        {!file ? (
          <div className="space-y-3">
            <CsvTemplateDownloadButton onClick={() => downloadCsvTemplate(TEMPLATE_CONTENT, "team_members_template.csv")} />
            <CsvFileDropZone fileInputRef={fileInputRef} onFile={processFile} contentClassName="py-10" />
          </div>
        ) : (
          <div className="space-y-3">
            <CsvImportedFile fileName={file.name} onClear={handleClear} />
            <CsvIssueSummary
              issues={errors}
              listClassName="text-sm space-y-1"
              additionalIssuesLabel={count => `+ ${count} more issues`}
              additionalIssuesClassName="text-muted-foreground"
            />
            {parsedMembers.length > 0 && (
              <CsvPreviewShell
                containerClassName="flex-1 flex flex-col min-h-0 space-y-2"
                header={(
                  <div className="flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-primary" />
                      <p className="text-sm font-medium">{parsedMembers.length} member{parsedMembers.length !== 1 ? "s" : ""} found</p>
                    </div>
                    {invalidCount > 0 && <Badge variant="destructive" className="text-xs">{invalidCount} need{invalidCount === 1 ? "s" : ""} attention</Badge>}
                  </div>
                )}
                scrollAreaClassName="flex-1 min-h-0 rounded-lg border"
                contentClassName="p-2 space-y-2"
              >
                {parsedMembers.map(member => {
                  const nameMissing = !member.name.trim();
                  const emailMissing = !isValidEmail(member.email);
                  const hasIssue = nameMissing || emailMissing;
                  return (
                    <div key={member.id} className={`p-2 rounded-md text-sm ${hasIssue ? "bg-destructive/10 border border-destructive/30" : "bg-muted/50"}`}>
                      {nameMissing ? (
                        <div className="flex items-center gap-2 mb-2">
                          <Input type="text" placeholder="Enter member name" value={member.name} onChange={event => updateMemberField(member.id, "name", event.target.value)} className="h-8 text-sm font-medium" />
                          <Badge variant="outline" className={`shrink-0 text-xs ${getRoleBadgeClass(member.role)}`}>{member.role}</Badge>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium truncate flex-1">{member.name}</p>
                          <Badge variant="outline" className={`shrink-0 text-xs ${getRoleBadgeClass(member.role)}`}>{member.role}</Badge>
                        </div>
                      )}
                      {emailMissing ? (
                        <div className="mt-2 flex items-center gap-2">
                          <Mail className="h-3.5 w-3.5 text-destructive shrink-0" />
                          <Input type="email" placeholder="Enter email address" value={member.email} onChange={event => updateMemberField(member.id, "email", event.target.value)} className="h-8 text-sm" />
                        </div>
                      ) : <p className="text-xs text-muted-foreground truncate mt-1">{member.email}</p>}
                      {member.children.length > 0 && <p className="text-xs text-primary truncate mt-1">Children: {member.children.map(child => child.yearOfBirth ? `${child.name} (${child.yearOfBirth})` : child.name).join(", ")}</p>}
                    </div>
                  );
                })}
              </CsvPreviewShell>
            )}
            {parsedMembers.length === 0 && errors.length > 0 && (
              <div className="text-center py-4 text-muted-foreground">
                <p className="text-sm">No valid members found</p>
                <p className="text-xs">Please fix the errors above and try again</p>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 pt-4 border-t shrink-0">
        {!allMembersValid && parsedMembers.length > 0 && <p className="text-xs text-destructive text-center">Please fill in all required fields (name, email) before sending invites</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-1" onClick={handleImport} disabled={parsedMembers.length === 0 || hasBlockingErrors || !allMembersValid}>
            <Send className="h-4 w-4 mr-2" />
            Send Invites {parsedMembers.length > 0 ? `(${parsedMembers.length})` : ""}
          </Button>
        </div>
      </div>
    </CsvImportDialogFrame>
  );
}
