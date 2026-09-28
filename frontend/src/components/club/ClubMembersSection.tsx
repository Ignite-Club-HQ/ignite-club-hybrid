import { Suspense } from "react";
import type { ComponentProps } from "react";
import { Search, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import PendingInviteCard from "@/components/PendingInviteCard";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { friendlyQueryErrorMessage } from "@/lib/friendlyQueryError";

const AddClubAdminSheet = lazyWithRetry(() => import("@/components/AddClubAdminSheet"));

const ROLE_COLORS: Record<string, string> = {
  app_admin: "bg-red-500/15 text-red-400 dark:text-red-400 border-red-500/30",
  club_admin: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
  team_admin: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  coach: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  committee_member: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  player: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  parent: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30",
  league_admin: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  basic_user: "bg-muted text-muted-foreground border-border",
};

export interface ClubMemberProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  ignite_points?: number | null;
}

export interface ClubMemberRole {
  id: string;
  role: string;
  scopeName?: string;
  teamId: string | null;
  teamName: string | null;
}

export interface ClubMemberEntry {
  profile: ClubMemberProfile | null;
  roles: ClubMemberRole[];
}

type PendingInvite = ComponentProps<typeof PendingInviteCard>["invite"];

interface ClubMembersSectionProps {
  clubId: string;
  clubName: string;
  isAdmin: boolean;
  clubMembers: Record<string, ClubMemberEntry>;
  isMembersLoading: boolean;
  isMembersError: boolean;
  membersError: unknown;
  onRetry: () => void;
  pendingInvites: readonly PendingInvite[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  displayCount: number;
  onShowMore: () => void;
}

function filterEntries(
  entries: [string, ClubMemberEntry][],
  query: string,
) {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(([, member]) => {
    const name = member.profile?.display_name?.toLowerCase() || "";
    if (name.includes(q)) return true;
    return member.roles?.some((roleItem) => {
      const role = roleItem.role?.replace(/_/g, " ").toLowerCase() || "";
      const scope = roleItem.scopeName?.toLowerCase() || "";
      const team = roleItem.teamName?.toLowerCase() || "";
      return role.includes(q) || scope.includes(q) || team.includes(q);
    });
  });
}

function MemberCard({ userId, member }: { userId: string; member: ClubMemberEntry }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarImage src={member.profile?.avatar_url || undefined} />
          <AvatarFallback className="bg-primary/20 text-primary text-sm">
            {member.profile?.display_name?.charAt(0)?.toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{member.profile?.display_name || "Unknown User"}</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {member.roles?.map((roleItem) => {
              const colorClass = ROLE_COLORS[roleItem.role] || ROLE_COLORS.basic_user;
              return (
                <Badge
                  key={roleItem.id}
                  variant="outline"
                  className={`text-[10px] rounded-md border px-1.5 py-0.5 ${colorClass}`}
                >
                  {roleItem.role?.replace(/_/g, " ") || "Member"}
                  {roleItem.scopeName && ` • ${roleItem.scopeName}`}
                </Badge>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ClubMembersSection({
  clubId,
  clubName,
  isAdmin,
  clubMembers,
  isMembersLoading,
  isMembersError,
  membersError,
  onRetry,
  pendingInvites,
  searchQuery,
  onSearchQueryChange,
  displayCount,
  onShowMore,
}: ClubMembersSectionProps) {
  const hasMembers = Object.keys(clubMembers).length > 0;

  if (isMembersLoading) {
    return (
      <div className="space-y-2 pt-2">
        {isAdmin && (
          <div className="flex items-center gap-2 justify-end mb-3">
            <Suspense fallback={null}>
              <AddClubAdminSheet clubId={clubId} clubName={clubName} />
            </Suspense>
          </div>
        )}
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-3 flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-16 ml-auto" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (isMembersError && !hasMembers) {
    return (
      <div className="space-y-2 pt-2">
        {isAdmin && (
          <div className="flex items-center gap-2 justify-end mb-3">
            <Suspense fallback={null}>
              <AddClubAdminSheet clubId={clubId} clubName={clubName} />
            </Suspense>
          </div>
        )}
        <div className="flex flex-col items-start gap-2 py-2">
          <p className="text-sm text-muted-foreground">
            {friendlyQueryErrorMessage(membersError, "the club member list")}
          </p>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const filteredEntries = filterEntries(Object.entries(clubMembers), searchQuery);

  return (
    <div className="space-y-2 pt-2">
      {isAdmin && (
        <div className="flex items-center gap-2 justify-end mb-3">
          <Suspense fallback={null}>
            <AddClubAdminSheet clubId={clubId} clubName={clubName} />
          </Suspense>
        </div>
      )}
      {hasMembers && (
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search members by name, role or team"
            className="pl-9 pr-9 h-10"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchQueryChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              aria-label="Clear member search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {!hasMembers && pendingInvites.length === 0 ? (
        <p className="text-muted-foreground text-sm">No members yet</p>
      ) : (
        <>
          {pendingInvites.map((invite) => (
            <PendingInviteCard key={invite.id} invite={invite} clubId={clubId} />
          ))}
          {searchQuery.trim() && filteredEntries.length === 0 ? (
            <p className="text-muted-foreground text-sm py-3 text-center">
              No members match "{searchQuery}"
            </p>
          ) : (
            <>
              {filteredEntries.slice(0, displayCount).map(([userId, member]) => (
                <MemberCard key={userId} userId={userId} member={member} />
              ))}
              {filteredEntries.length > displayCount && (
                <Button variant="outline" className="w-full" onClick={onShowMore}>
                  Show more ({filteredEntries.length - displayCount} remaining)
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
