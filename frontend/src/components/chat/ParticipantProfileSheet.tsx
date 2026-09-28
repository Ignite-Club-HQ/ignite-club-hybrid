import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { ROLE_BADGE_CLASS, type MemberRole } from "@/lib/memberIdentity";

export interface ParticipantRoleEntry {
  role: string;
  team_id: string | null;
  team_name: string | null;
}

interface ParticipantProfileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  avatarUrl?: string | null;
  roles: ParticipantRoleEntry[];
  online?: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  app_admin: "App Admin",
  club_admin: "Club Admin",
  league_admin: "League Admin",
  committee_member: "Committee Member",
  team_admin: "Team Admin",
  coach: "Coach",
  parent: "Parent",
  player: "Player",
  basic_user: "Member",
};

function formatRole(role: string) {
  return ROLE_LABEL[role] ?? role.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

export function ParticipantProfileSheet({
  open,
  onOpenChange,
  displayName,
  avatarUrl,
  roles,
  online,
}: ParticipantProfileSheetProps) {
  // Group roles by team (null team = club/global roles)
  const groups = new Map<string, { teamName: string | null; roles: string[] }>();
  for (const r of roles) {
    const key = r.team_id ?? "__club__";
    if (!groups.has(key)) {
      groups.set(key, { teamName: r.team_id ? r.team_name : null, roles: [] });
    }
    const g = groups.get(key)!;
    if (!g.roles.includes(r.role)) g.roles.push(r.role);
  }

  // Club/global first, then teams alphabetically
  const orderedGroups = Array.from(groups.entries()).sort((a, b) => {
    if (a[0] === "__club__") return -1;
    if (b[0] === "__club__") return 1;
    return (a[1].teamName || "").localeCompare(b[1].teamName || "");
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="sr-only">Participant profile</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="flex flex-col items-center text-center px-4 pb-2">
          <div className="relative">
            <Avatar className="h-16 w-16">
              <AvatarImage src={avatarUrl || undefined} />
              <AvatarFallback className="text-lg">
                {displayName?.[0]?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            {online && (
              <span
                className="absolute bottom-0 right-0 block h-3.5 w-3.5 rounded-full bg-green-500 ring-2 ring-background"
                aria-label="Online"
              />
            )}
          </div>
          <h3 className="mt-3 text-base font-semibold">{displayName}</h3>
          {online && (
            <p className="text-xs text-muted-foreground mt-0.5">Online</p>
          )}
        </div>

        <div className="px-4 pb-6 space-y-4 max-h-[55vh] overflow-y-auto">
          {orderedGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center">No roles</p>
          ) : (
            orderedGroups.map(([key, g]) => (
              <div key={key}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  {g.teamName ?? "Club"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {g.roles.map((r) => (
                    <span
                      key={r}
                      className={cn(
                        "text-[11px] font-medium px-2 py-0.5 rounded-md border",
                        ROLE_BADGE_CLASS[r as MemberRole] ??
                          "bg-muted text-muted-foreground border-border",
                      )}
                    >
                      {formatRole(r)}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
