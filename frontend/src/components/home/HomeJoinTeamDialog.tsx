import { CheckCircle2 } from "lucide-react";
import { MobileCardSelect } from "@/components/MobileCardSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { getSportEmoji } from "@/lib/sportEmojis";

export type HomeTeamRole = "player" | "parent" | "coach" | "team_admin";
export type HomeLeagueRole = "league_admin" | "parent";

interface HomeJoinClub {
  id: string;
  name: string;
  sport: string | null;
  class_mode_enabled: boolean;
}

interface HomeJoinTeam {
  id: string;
  name: string;
  club_id: string;
  clubs: { name: string; sport: string | null };
}

interface HomeJoinLeague {
  id: string;
  name: string;
  club_id: string;
  clubs: { name: string; sport: string | null };
}

interface HomeJoinTeamDialogProps {
  open: boolean;
  activeClubFilter: string | null;
  clubs: HomeJoinClub[] | undefined;
  teams: HomeJoinTeam[] | undefined;
  miniLeagues: HomeJoinLeague[] | undefined;
  selectedClubForTeam: string;
  selectedTeam: string;
  isLeagueSelected: boolean;
  isAlreadyTeamMember: boolean;
  existingTeamRoles: HomeTeamRole[];
  pendingTeamRequests: HomeTeamRole[] | undefined;
  additionalAccessPending: boolean;
  additionalAccessRole: HomeTeamRole | undefined;
  selectedLeagueRole: HomeLeagueRole;
  selectedTeamRole: HomeTeamRole;
  showChildLinker: boolean;
  teamChildren: Array<{ id: string; name: string }> | undefined;
  selectedChildForLink: string;
  newChildName: string;
  hasExistingTeamRole: boolean | undefined | "";
  hasExistingLeagueRole: boolean | undefined | null | "";
  submitPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectedClubForTeamChange: (clubId: string) => void;
  onSelectedTeamChange: (teamId: string) => void;
  onSelectedLeagueRoleChange: (role: HomeLeagueRole) => void;
  onSelectedTeamRoleChange: (role: HomeTeamRole) => void;
  onSelectedChildForLinkChange: (childId: string) => void;
  onNewChildNameChange: (name: string) => void;
  onRequestAdditionalAccess: (role: HomeTeamRole) => void;
  onSubmit: () => void;
}

const teamRoleOptions = [
  { value: "player", label: "Player" },
  { value: "parent", label: "Parent" },
  { value: "coach", label: "Coach" },
  { value: "team_admin", label: "Team Admin" },
] satisfies Array<{ value: HomeTeamRole; label: string }>;

const leagueRoleOptions = [
  { value: "league_admin", label: "League Admin" },
  { value: "parent", label: "Parent" },
] satisfies Array<{ value: HomeLeagueRole; label: string }>;

const teamRoleLabel = (role: HomeTeamRole) =>
  role === "team_admin"
    ? "Team Admin"
    : role === "coach"
      ? "Coach"
      : role === "player"
        ? "Player"
        : "Parent";

export function HomeJoinTeamDialog({
  open,
  activeClubFilter,
  clubs,
  teams,
  miniLeagues,
  selectedClubForTeam,
  selectedTeam,
  isLeagueSelected,
  isAlreadyTeamMember,
  existingTeamRoles,
  pendingTeamRequests,
  additionalAccessPending,
  additionalAccessRole,
  selectedLeagueRole,
  selectedTeamRole,
  showChildLinker,
  teamChildren,
  selectedChildForLink,
  newChildName,
  hasExistingTeamRole,
  hasExistingLeagueRole,
  submitPending,
  onOpenChange,
  onSelectedClubForTeamChange,
  onSelectedTeamChange,
  onSelectedLeagueRoleChange,
  onSelectedTeamRoleChange,
  onSelectedChildForLinkChange,
  onNewChildNameChange,
  onRequestAdditionalAccess,
  onSubmit,
}: HomeJoinTeamDialogProps) {
  const activeClub = clubs?.find((club) => club.id === activeClubFilter);
  const isClassMode = !!activeClubFilter && !!activeClub?.class_mode_enabled;
  const selectedClub = selectedClubForTeam || "all";
  const availableTeams = teams
    ?.filter((team) =>
      activeClubFilter
        ? team.club_id === activeClubFilter
        : selectedClub === "all" || team.club_id === selectedClub,
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const availableLeagues = miniLeagues
    ?.filter((league) =>
      activeClubFilter
        ? league.club_id === activeClubFilter
        : selectedClub === "all" || league.club_id === selectedClub,
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const shouldEnterNewChild =
    selectedChildForLink === "__new__" ||
    (!selectedChildForLink && (!teamChildren || teamChildren.length === 0));
  const submitDisabled =
    !selectedTeam ||
    submitPending ||
    !!hasExistingTeamRole ||
    !!hasExistingLeagueRole ||
    (showChildLinker && shouldEnterNewChild && !newChildName.trim());

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {isClassMode ? "Request to Join Class" : "Request to Join Team"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {isClassMode
              ? "Select a class and role to request membership."
              : "Select a team and role to request membership."}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4 pt-4">
          {!activeClubFilter && (
            <MobileCardSelect
              value={selectedClub}
              onValueChange={onSelectedClubForTeamChange}
              options={[
                { value: "all", label: "All clubs" },
                ...(clubs?.map((club) => ({
                  value: club.id,
                  label: club.name,
                  icon: <span>{getSportEmoji(club.sport)}</span>,
                })) || []),
              ]}
              label="Select Club (optional)"
              placeholder="All clubs..."
              searchable
              searchPlaceholder="Search clubs..."
              emptyMessage="No clubs found."
            />
          )}
          <MobileCardSelect
            value={selectedTeam}
            onValueChange={onSelectedTeamChange}
            options={[
              ...(availableTeams?.map((team) => ({
                value: team.id,
                label: activeClubFilter
                  ? team.name
                  : `${team.name} (${team.clubs?.name})`,
                icon: <span>{getSportEmoji(team.clubs?.sport)}</span>,
              })) || []),
              ...(availableLeagues?.map((league) => ({
                value: `league_${league.id}`,
                label: activeClubFilter
                  ? `⭐ ${league.name} (League)`
                  : `⭐ ${league.name} (${league.clubs?.name}) - League`,
                icon: <span>⭐</span>,
              })) || []),
            ]}
            label={isClassMode ? "Select Class" : "Select Team"}
            placeholder={isClassMode ? "Choose a class..." : "Choose a team..."}
            searchable
            searchPlaceholder={isClassMode ? "Search classes..." : "Search teams..."}
            emptyMessage={isClassMode ? "No classes found." : "No teams found."}
          />

          {isAlreadyTeamMember && !isLeagueSelected ? (
            <div className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <p className="text-sm font-semibold text-foreground">
                    You're already on this team
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {existingTeamRoles.map((role) => (
                    <Badge key={role} variant="secondary" className="text-xs">
                      {teamRoleLabel(role)}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  No need to rejoin. Request elevated access below and a team
                  admin will review it.
                </p>
              </div>
              {(["coach", "team_admin"] as HomeTeamRole[])
                .filter((role) => !existingTeamRoles.includes(role))
                .map((role) => {
                  const isPending = pendingTeamRequests?.includes(role);
                  const isSubmitting =
                    additionalAccessPending && additionalAccessRole === role;
                  return (
                    <div
                      key={role}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          Request {teamRoleLabel(role)} Access
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {role === "coach"
                            ? "Manage training, line-ups and player performance."
                            : "Manage roster, events and team settings."}
                        </p>
                      </div>
                      {isPending ? (
                        <Badge variant="outline" className="shrink-0">
                          Pending
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          onClick={() => onRequestAdditionalAccess(role)}
                          disabled={isSubmitting}
                        >
                          {isSubmitting ? "Sending…" : "Request"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              {(["coach", "team_admin"] as HomeTeamRole[]).every((role) =>
                existingTeamRoles.includes(role),
              ) && (
                <p className="text-xs text-muted-foreground">
                  You already have the highest-level access available on this
                  team.
                </p>
              )}
            </div>
          ) : (
            <>
              {isLeagueSelected ? (
                <MobileCardSelect
                  value={selectedLeagueRole}
                  onValueChange={(value) =>
                    onSelectedLeagueRoleChange(value as HomeLeagueRole)
                  }
                  options={leagueRoleOptions}
                  label="Select Role"
                  placeholder="Choose a role..."
                />
              ) : (
                <MobileCardSelect
                  value={selectedTeamRole}
                  onValueChange={(value) =>
                    onSelectedTeamRoleChange(value as HomeTeamRole)
                  }
                  options={teamRoleOptions}
                  label="Select Role"
                  placeholder="Choose a role..."
                />
              )}
              {showChildLinker && (
                <>
                  <MobileCardSelect
                    value={
                      selectedChildForLink ||
                      (teamChildren && teamChildren.length > 0 ? "" : "__new__")
                    }
                    onValueChange={onSelectedChildForLinkChange}
                    options={[
                      ...(teamChildren?.map((child) => ({
                        value: child.id,
                        label: child.name,
                      })) || []),
                      { value: "__new__", label: "➕ Add new child" },
                    ]}
                    label="Link to Your Child"
                    placeholder="Select your child..."
                    searchable
                    searchPlaceholder="Search children..."
                    emptyMessage="No existing children — add one below."
                  />
                  {shouldEnterNewChild && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">
                        Child's name
                      </label>
                      <input
                        type="text"
                        value={newChildName}
                        onChange={(event) =>
                          onNewChildNameChange(event.target.value)
                        }
                        placeholder="Enter your child's full name"
                        className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <ResponsiveDialogFooter>
          {isAlreadyTeamMember && !isLeagueSelected ? (
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => onOpenChange(false)}
            >
              Done
            </Button>
          ) : (
            <>
              {(hasExistingTeamRole || hasExistingLeagueRole) && (
                <p className="text-sm text-destructive mb-2">
                  You already have this role in this{" "}
                  {isLeagueSelected ? "league" : "team"}
                </p>
              )}
              <Button
                className="w-full sm:w-auto"
                onClick={onSubmit}
                disabled={submitDisabled}
              >
                {submitPending ? "Submitting..." : "Submit Request"}
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
