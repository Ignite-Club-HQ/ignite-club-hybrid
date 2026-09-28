import type { ReactNode } from "react";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { SwipeableCard } from "@/components/ui/swipeable-card";
import {
  ArrowRightLeft,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import PendingInvitesList from "@/components/PendingInvitesList";
import { friendlyQueryErrorMessage } from "@/lib/friendlyQueryError";
import { cn } from "@/lib/utils";

export type TeamMemberEntry = {
  profile: any;
  roles: { id: string; role: string }[];
};
export type TeamMembersRecord = Record<string, TeamMemberEntry>;

export type TeamSelectedChild = {
  childId: string;
  childName: string;
  parentDisplay: string | null;
  isPending: boolean;
  linkInviteIds?: string[];
};

export type TeamLinkChildToParent = {
  childName: string;
  existingChildId?: string;
  pendingInviteIds: string[];
};

export type TeamMoveToTeam = {
  type: "adult" | "child";
  id: string;
  name: string;
  roles?: string[];
};

export type TeamAddRoleMember = {
  userId: string;
  userName: string;
  existingRoles: string[];
};

export type TeamSelectedMember = {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  roles: { id: string; role: string }[];
};

interface TeamMembersSectionProps {
  teamId: string | undefined;
  members: TeamMembersRecord;
  teamChildren: any[];
  pendingInvites: any[];
  memberRoleFilter: string;
  adultPlayerCount: number;
  isAdmin: boolean;
  isClubAdmin: boolean;
  currentUserId: string | undefined;
  isMembersLoading: boolean;
  isMembersFetching: boolean;
  isChildrenLoading: boolean;
  isChildrenFetching: boolean;
  isMembersError: boolean;
  membersError: unknown;
  refetchMembers: () => unknown;
  refetchChildren: () => unknown;
  isSoccerClub: boolean;
  onOpenHeaderInvite: () => void;
  onOpenAddPlayer: () => void;
  onSelectChild: (value: TeamSelectedChild) => void;
  onLinkChildToParent: (value: TeamLinkChildToParent) => void;
  onMoveToTeam: (value: TeamMoveToTeam) => void;
  onAddRoleMember: (value: TeamAddRoleMember) => void;
  onSelectMember: (value: TeamSelectedMember) => void;
  onInviteParentChild: (value: { childId: string; childName: string }) => void;
  onOpenPositionSheet: (value: {
    id: string;
    name: string;
    type: "member" | "child";
  }) => void;
  onRemoveMember: (value: { userId: string; name: string }) => void;
}

/**
 * The "Team" accordion section: role-grouped member/child roster with
 * pending-invite matching, swipe actions (link/swap/remove/role), and the
 * empty/error/loading states. TeamDetailPage retains all query/mutation
 * ownership and passes data plus selection callbacks in as props.
 */
export function TeamMembersSection({
  teamId,
  members,
  teamChildren,
  pendingInvites,
  memberRoleFilter,
  adultPlayerCount,
  isAdmin,
  isClubAdmin,
  currentUserId,
  isMembersLoading,
  isMembersFetching,
  isChildrenLoading,
  isChildrenFetching,
  isMembersError,
  membersError,
  refetchMembers,
  refetchChildren,
  isSoccerClub,
  onOpenHeaderInvite,
  onOpenAddPlayer,
  onSelectChild,
  onLinkChildToParent,
  onMoveToTeam,
  onAddRoleMember,
  onSelectMember,
  onInviteParentChild,
  onOpenPositionSheet,
  onRemoveMember,
}: TeamMembersSectionProps) {
  return (
    <AccordionItem value="members" className="border rounded-lg px-4">
      {/* Refresh button is a SIBLING of the trigger — never nested inside it,
                so no <button> ever descends from another <button>. */}
      <div className="flex items-center gap-2">
        <AccordionTrigger className="hover:no-underline flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Users
              className="h-5 w-5 text-primary shrink-0"
              aria-hidden="true"
            />
            <div className="flex flex-col min-w-0">
              <h2 className="text-base font-semibold leading-tight">Team</h2>
              <span className="text-[10px] text-muted-foreground leading-tight">
                Players, parents & coaches
              </span>
            </div>
            <div className="flex -space-x-2 ml-auto shrink-0">
              {Object.values(members)
                .slice(0, 5)
                .map((member, i) => (
                  <Avatar
                    key={i}
                    className="h-7 w-7 border-2 border-background"
                  >
                    <AvatarImage
                      src={member.profile?.avatar_url || undefined}
                    />
                    <AvatarFallback className="bg-primary/20 text-primary text-[9px]">
                      {member.profile?.display_name?.charAt(0)?.toUpperCase() ||
                        "?"}
                    </AvatarFallback>
                  </Avatar>
                ))}
              {Object.keys(members).length + teamChildren.length > 5 && (
                <Avatar className="h-7 w-7 border-2 border-background">
                  <AvatarFallback className="bg-muted text-muted-foreground text-[9px]">
                    +{Object.keys(members).length + teamChildren.length - 5}
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          </div>
        </AccordionTrigger>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label="Refresh members list"
          onClick={(e) => {
            e.stopPropagation();
            refetchMembers();
            refetchChildren();
          }}
          disabled={isMembersFetching || isChildrenFetching}
        >
          <RefreshCw
            className={`h-4 w-4 ${isMembersFetching || isChildrenFetching ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
        </Button>
      </div>
      <AccordionContent>
        <div className="space-y-4 pt-2">
          {isMembersError && Object.keys(members).length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center gap-3">
              <p className="text-sm text-muted-foreground max-w-xs">
                {friendlyQueryErrorMessage(
                  membersError,
                  "the team member list",
                )}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetchMembers()}
              >
                <RefreshCw className="h-4 w-4 mr-1.5" aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : Object.keys(members).length === 0 &&
            teamChildren.length === 0 &&
            pendingInvites.length === 0 &&
            !isMembersLoading &&
            !isChildrenLoading &&
            !isMembersFetching &&
            !isChildrenFetching ? (
            <div className="flex flex-col items-center py-6 text-center gap-3">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <UserPlus className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">No members yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Invite players, parents or coaches to get started
                </p>
              </div>
              <Button size="sm" onClick={() => onOpenHeaderInvite()}>
                <UserPlus className="h-4 w-4 mr-1.5" />
                Invite Members
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {Object.keys(members).length === 0 &&
                teamChildren.length === 0 &&
                pendingInvites.length === 0 &&
                (isMembersFetching || isChildrenFetching) && (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
              {/* Combined Players section — child players first, adult players
                        continue directly below under the same heading. */}
              {(teamChildren.length > 0 ||
                pendingInvites.some((inv) => {
                  const meta = inv.metadata as {
                    children?: { name: string }[];
                  } | null;
                  return meta?.children && meta.children.length > 0;
                })) &&
                (memberRoleFilter === "all" ||
                  memberRoleFilter === "child") && (
                  <div
                    className={
                      adultPlayerCount > 0 ? "mb-2" : "mb-6 pb-4 border-b"
                    }
                  >
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Players (
                        {(() => {
                          const pendingOnlyCount = (() => {
                            const confirmedIds = new Set(
                              teamChildren
                                .map((a: any) => a.children?.id)
                                .filter(Boolean),
                            );
                            const confirmedNames = new Set(
                              teamChildren
                                .map((a: any) =>
                                  a.children?.name?.toLowerCase()?.trim(),
                                )
                                .filter(Boolean),
                            );
                            const seen = new Set<string>();
                            for (const inv of pendingInvites) {
                              const meta = inv.metadata as {
                                children?: {
                                  name: string;
                                  child_id?: string;
                                  existingChildId?: string;
                                }[];
                              } | null;
                              if (!meta?.children) continue;
                              for (const c of meta.children) {
                                if (!c.name) continue;
                                if (c.child_id && confirmedIds.has(c.child_id))
                                  continue;
                                if (
                                  confirmedNames.has(
                                    c.name.toLowerCase().trim(),
                                  )
                                )
                                  continue;
                                if (
                                  typeof c.existingChildId === "string" &&
                                  c.existingChildId.startsWith("pending-")
                                )
                                  continue;
                                seen.add(c.name.toLowerCase().trim());
                              }
                            }
                            return seen.size;
                          })();
                          return (
                            teamChildren.length +
                            pendingOnlyCount +
                            adultPlayerCount
                          );
                        })()}
                        )
                      </p>
                      {(isAdmin || isClubAdmin) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => onOpenAddPlayer()}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          Add player
                        </Button>
                      )}
                    </div>
                    <div className="space-y-2.5">
                      {(() => {
                        const pendingChildIds = new Set<string>();
                        const pendingChildNames = new Set<string>();
                        const pendingParentLabels = new Map<string, string>();
                        for (const inv of pendingInvites) {
                          const meta = inv.metadata as {
                            children?: { name: string; child_id?: string }[];
                          } | null;
                          if (!meta?.children) continue;
                          const parentLabel =
                            inv.invited_label ||
                            inv.invited_email?.split("@")[0] ||
                            "Pending Parent";
                          for (const child of meta.children) {
                            if (child.child_id) {
                              pendingChildIds.add(child.child_id);
                              pendingParentLabels.set(
                                child.child_id,
                                parentLabel,
                              );
                            }
                            if (child.name) {
                              pendingChildNames.add(child.name.toLowerCase());
                              pendingParentLabels.set(
                                child.name.toLowerCase(),
                                parentLabel,
                              );
                            }
                          }
                        }

                        const sorted = [...teamChildren].sort(
                          (a: any, b: any) => {
                            const aChild = a.children;
                            const bChild = b.children;
                            const aIsPending =
                              aChild &&
                              (pendingChildIds.has(aChild.id) ||
                                (aChild.name &&
                                  pendingChildNames.has(
                                    aChild.name.toLowerCase(),
                                  ) &&
                                  (!aChild.allParentNames ||
                                    aChild.allParentNames.length === 0)))
                                ? 1
                                : 0;
                            const bIsPending =
                              bChild &&
                              (pendingChildIds.has(bChild.id) ||
                                (bChild.name &&
                                  pendingChildNames.has(
                                    bChild.name.toLowerCase(),
                                  ) &&
                                  (!bChild.allParentNames ||
                                    bChild.allParentNames.length === 0)))
                                ? 1
                                : 0;
                            return aIsPending - bIsPending;
                          },
                        );

                        return sorted.map((assignment: any) => {
                          const child = assignment.children;
                          if (!child) return null;
                          const isPending =
                            pendingChildIds.has(child.id) ||
                            (child.name &&
                              pendingChildNames.has(child.name.toLowerCase()) &&
                              (!child.allParentNames ||
                                child.allParentNames.length === 0));
                          const parentLabel =
                            pendingParentLabels.get(child.id) ||
                            pendingParentLabels.get(child.name?.toLowerCase());

                          const parentDisplay =
                            isPending && parentLabel
                              ? `Parent: ${parentLabel}`
                              : child.allParentNames &&
                                  child.allParentNames.length > 0
                                ? `${child.allParentNames.length === 1 ? "Parent" : "Parents"}: ${child.allParentNames.join(" & ")}`
                                : null;

                          const swipeActions = (() => {
                            if (!(isAdmin || isClubAdmin)) return [];
                            if (isPending) {
                              return [
                                {
                                  label: "Link",
                                  icon: <UserPlus className="h-4 w-4" />,
                                  onClick: () => {
                                    const inviteIds = pendingInvites
                                      .filter((inv) => {
                                        const meta = inv.metadata as {
                                          children?: {
                                            name: string;
                                            child_id?: string;
                                          }[];
                                        } | null;
                                        return meta?.children?.some(
                                          (c) =>
                                            c.child_id === child.id ||
                                            c.name?.toLowerCase() ===
                                              child.name?.toLowerCase(),
                                        );
                                      })
                                      .map((inv) => inv.id);
                                    onLinkChildToParent({
                                      childName: child.name,
                                      existingChildId: child.id,
                                      pendingInviteIds: inviteIds,
                                    });
                                  },
                                  className: "bg-orange-500 text-white",
                                },
                              ];
                            }
                            const actions: {
                              label: string;
                              icon: ReactNode;
                              onClick: () => void;
                              className?: string;
                            }[] = [
                              {
                                label: "Parent",
                                icon: <UserPlus className="h-4 w-4" />,
                                onClick: () =>
                                  onInviteParentChild({
                                    childId: child.id,
                                    childName: child.name,
                                  }),
                                className: "bg-emerald-600 text-white",
                              },
                            ];
                            if (isSoccerClub) {
                              actions.push({
                                label: "Position",
                                icon: <Pencil className="h-4 w-4" />,
                                onClick: () =>
                                  onOpenPositionSheet({
                                    id: child.id,
                                    name: child.name,
                                    type: "child",
                                  }),
                                className: "bg-blue-500 text-white",
                              });
                            }
                            if (isClubAdmin) {
                              actions.push({
                                label: "Swap",
                                icon: <ArrowRightLeft className="h-4 w-4" />,
                                onClick: () =>
                                  onMoveToTeam({
                                    type: "child",
                                    id: child.id,
                                    name: child.name,
                                  }),
                                className: "bg-amber-500 text-white",
                              });
                            }
                            return actions;
                          })();

                          return (
                            <SwipeableCard
                              key={assignment.id}
                              actions={swipeActions}
                              enabled={isAdmin || isClubAdmin}
                              className={cn("border shadow-sm", "")}
                            >
                              <CardContent
                                className="p-3.5 flex items-center gap-3 cursor-pointer"
                                onClick={() =>
                                  onSelectChild({
                                    childId: child.id,
                                    childName: child.name,
                                    parentDisplay,
                                    isPending: !!isPending,
                                    linkInviteIds: isPending
                                      ? pendingInvites
                                          .filter((inv) => {
                                            const meta = inv.metadata as {
                                              children?: {
                                                name: string;
                                                child_id?: string;
                                              }[];
                                            } | null;
                                            return meta?.children?.some(
                                              (c) =>
                                                c.child_id === child.id ||
                                                c.name?.toLowerCase() ===
                                                  child.name?.toLowerCase(),
                                            );
                                          })
                                          .map((inv) => inv.id)
                                      : undefined,
                                  })
                                }
                              >
                                <Avatar className="h-9 w-9 shrink-0">
                                  <AvatarFallback
                                    className={cn(
                                      "text-sm font-semibold",
                                      isPending
                                        ? "bg-orange-500/20 text-orange-500"
                                        : "bg-pink-500/20 text-pink-500",
                                    )}
                                  >
                                    {child.name?.charAt(0)?.toUpperCase() ||
                                      "?"}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-sm truncate">
                                    {child.name}
                                  </p>
                                  {parentDisplay && (
                                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                                      {parentDisplay}
                                    </p>
                                  )}
                                </div>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[10px] border px-1.5 py-0 h-4 shrink-0",
                                    isPending
                                      ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                                      : "bg-pink-500/20 text-pink-400 border-pink-500/30",
                                  )}
                                >
                                  {isPending ? "Pending" : "Child"}
                                </Badge>
                              </CardContent>
                            </SwipeableCard>
                          );
                        });
                      })()}
                      {(() => {
                        const confirmedChildIds = new Set(
                          teamChildren
                            .map((a: any) => a.children?.id)
                            .filter(Boolean),
                        );
                        const confirmedChildNames = new Set(
                          teamChildren
                            .map((a: any) =>
                              a.children?.name?.toLowerCase()?.trim(),
                            )
                            .filter(Boolean),
                        );

                        const isConfirmedChild = (name: string) => {
                          const norm = name.toLowerCase().trim();
                          if (confirmedChildNames.has(norm)) return true;
                          for (const confirmed of confirmedChildNames) {
                            if (Math.abs(norm.length - confirmed.length) > 2)
                              continue;
                            const len1 = norm.length,
                              len2 = confirmed.length;
                            const dp: number[][] = Array.from(
                              { length: len1 + 1 },
                              (_, i) =>
                                Array.from({ length: len2 + 1 }, (_, j) =>
                                  i === 0 ? j : j === 0 ? i : 0,
                                ),
                            );
                            for (let i = 1; i <= len1; i++) {
                              for (let j = 1; j <= len2; j++) {
                                dp[i][j] =
                                  norm[i - 1] === confirmed[j - 1]
                                    ? dp[i - 1][j - 1]
                                    : 1 +
                                      Math.min(
                                        dp[i - 1][j],
                                        dp[i][j - 1],
                                        dp[i - 1][j - 1],
                                      );
                              }
                            }
                            if (dp[len1][len2] <= 2) return true;
                          }
                          return false;
                        };

                        const seenPendingNames = new Map<
                          string,
                          {
                            name: string;
                            parentLabels: string[];
                            inviteIds: string[];
                          }
                        >();

                        for (const inv of pendingInvites) {
                          const meta = inv.metadata as {
                            children?: {
                              name: string;
                              child_id?: string;
                              existingChildId?: string;
                            }[];
                          } | null;
                          if (!meta?.children) continue;
                          const parentLabel =
                            inv.invited_label ||
                            inv.invited_email?.split("@")[0] ||
                            "Pending Parent";

                          for (const child of meta.children) {
                            if (!child.name) continue;
                            if (
                              child.child_id &&
                              confirmedChildIds.has(child.child_id)
                            )
                              continue;
                            if (isConfirmedChild(child.name)) continue;
                            if (
                              typeof child.existingChildId === "string" &&
                              child.existingChildId.startsWith("pending-")
                            )
                              continue;

                            const key = child.name.toLowerCase().trim();
                            const existing = seenPendingNames.get(key);
                            if (existing) {
                              if (
                                !existing.parentLabels.includes(parentLabel)
                              ) {
                                existing.parentLabels.push(parentLabel);
                              }
                              if (!existing.inviteIds.includes(inv.id)) {
                                existing.inviteIds.push(inv.id);
                              }
                            } else {
                              seenPendingNames.set(key, {
                                name: child.name,
                                parentLabels: [parentLabel],
                                inviteIds: [inv.id],
                              });
                            }
                          }
                        }

                        return Array.from(seenPendingNames.entries()).map(
                          ([key, { name, parentLabels, inviteIds }]) => (
                            <SwipeableCard
                              key={`pending-child-${key}`}
                              enabled={isAdmin || isClubAdmin}
                              actions={
                                isAdmin || isClubAdmin
                                  ? [
                                      {
                                        label: "Link",
                                        icon: <UserPlus className="h-4 w-4" />,
                                        onClick: () =>
                                          onLinkChildToParent({
                                            childName: name,
                                            pendingInviteIds: inviteIds,
                                          }),
                                        className: "bg-orange-500",
                                      },
                                    ]
                                  : []
                              }
                              className="border shadow-sm"
                            >
                              <CardContent className="p-3.5 flex items-center gap-3">
                                <Avatar className="h-9 w-9 shrink-0">
                                  <AvatarFallback className="bg-orange-500/20 text-orange-500 text-sm font-semibold">
                                    {name?.charAt(0)?.toUpperCase() || "?"}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-sm truncate">
                                    {name}
                                  </p>
                                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                                    {parentLabels.length > 1
                                      ? `Parents: ${parentLabels.join(" & ")}`
                                      : `Parent: ${parentLabels[0]}`}
                                  </p>
                                </div>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border px-1.5 py-0 h-4 shrink-0 bg-orange-500/20 text-orange-400 border-orange-500/30"
                                >
                                  Pending
                                </Badge>
                              </CardContent>
                            </SwipeableCard>
                          ),
                        );
                      })()}
                    </div>
                  </div>
                )}

              {/* Role-grouped members with headers */}
              {(() => {
                // True when the child-players block above is on screen — the
                // adult "player" group then continues it without its own header.
                const childBlockShown =
                  (teamChildren.length > 0 ||
                    pendingInvites.some((inv) => {
                      const meta = inv.metadata as {
                        children?: { name: string }[];
                      } | null;
                      return !!meta?.children && meta.children.length > 0;
                    })) &&
                  (memberRoleFilter === "all" || memberRoleFilter === "child");
                const filteredMembers = Object.entries(members).filter(
                  ([_, member]) =>
                    memberRoleFilter === "all" || memberRoleFilter === "child"
                      ? memberRoleFilter === "all"
                      : member.roles?.some((r) => r.role === memberRoleFilter),
                );

                const roleOrder = [
                  "player",
                  "parent",
                  "team_admin",
                  "club_admin",
                  "app_admin",
                  "basic_user",
                ] as const;
                const roleGroupLabels: Record<string, string> = {
                  player: "Players",
                  parent: "Parents & Coaches",
                  team_admin: "Team Admins",
                  club_admin: "Club Admins",
                  app_admin: "App Admins",
                  basic_user: "Members",
                };
                const roleGroupMap: Record<string, string> = {
                  player: "player",
                  parent: "parent",
                  coach: "parent",
                  team_admin: "team_admin",
                  club_admin: "club_admin",
                  app_admin: "app_admin",
                  basic_user: "basic_user",
                };

                // Group members by their primary (highest-priority) role
                const grouped: Record<
                  string,
                  [string, (typeof members)[string]][]
                > = {};
                for (const entry of filteredMembers) {
                  const [, member] = entry;
                  const roles = member.roles || [];
                  let primaryRole = "basic_user";
                  let bestPriority = Infinity;
                  const allRoles = [
                    "player",
                    "parent",
                    "coach",
                    "team_admin",
                    "club_admin",
                    "app_admin",
                    "basic_user",
                  ];
                  for (const r of roles) {
                    const idx = allRoles.indexOf(r.role as any);
                    if (idx !== -1 && idx < bestPriority) {
                      bestPriority = idx;
                      primaryRole = r.role;
                    }
                  }
                  const mappedRole = roleGroupMap[primaryRole] || "basic_user";
                  if (!grouped[mappedRole]) grouped[mappedRole] = [];
                  grouped[mappedRole].push(entry);
                }

                // Group pending invites by role
                const pendingByRole: Record<string, typeof pendingInvites> = {};
                for (const inv of pendingInvites) {
                  if (
                    memberRoleFilter !== "all" &&
                    inv.role !== memberRoleFilter
                  )
                    continue;
                  const role = inv.role || "basic_user";
                  const mappedInvRole = roleGroupMap[role] || "basic_user";
                  if (!pendingByRole[mappedInvRole])
                    pendingByRole[mappedInvRole] = [];
                  pendingByRole[mappedInvRole].push(inv);
                }

                // Collect all roles that have members or pending invites
                const allRoles = new Set([
                  ...Object.keys(grouped),
                  ...Object.keys(pendingByRole),
                ]);

                return roleOrder
                  .filter((role) => allRoles.has(role))
                  .map((role) => {
                    const roleMembers = grouped[role] || [];
                    const rolePending = pendingByRole[role] || [];
                    if (roleMembers.length === 0 && rolePending.length === 0)
                      return null;

                    const mergeWithChildren =
                      role === "player" && childBlockShown;

                    return (
                      <div
                        key={role}
                        className="mb-3 pb-3 border-b last:border-b-0 last:mb-0 last:pb-0"
                      >
                        {!mergeWithChildren && (
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                            {roleGroupLabels[role] || role}
                          </p>
                        )}

                        <div className="space-y-2">
                          {roleMembers.map(([userId, member]) => {
                            const canManage =
                              (isAdmin || isClubAdmin) &&
                              userId !== currentUserId;
                            const memberSwipeActions: {
                              label: string;
                              icon: ReactNode;
                              onClick: () => void;
                              className?: string;
                            }[] = [];

                            if (isAdmin || isClubAdmin) {
                              memberSwipeActions.push({
                                label: "Role",
                                icon: <Plus className="h-4 w-4" />,
                                onClick: () =>
                                  onAddRoleMember({
                                    userId,
                                    userName:
                                      member.profile?.display_name || "User",
                                    existingRoles:
                                      member.roles?.map((r) => r.role) || [],
                                  }),
                                className: "bg-blue-600 text-white",
                              });
                            }
                            if (isClubAdmin && userId !== currentUserId) {
                              memberSwipeActions.push({
                                label: "Move",
                                icon: <ArrowRightLeft className="h-4 w-4" />,
                                onClick: () =>
                                  onMoveToTeam({
                                    type: "adult",
                                    id: userId,
                                    name:
                                      member.profile?.display_name || "User",
                                    roles:
                                      member.roles?.map((r) => r.role) || [],
                                  }),
                                className: "bg-amber-500 text-white",
                              });
                            }
                            if (canManage) {
                              memberSwipeActions.push({
                                label: "Remove",
                                icon: <Trash2 className="h-4 w-4" />,
                                onClick: () =>
                                  onRemoveMember({
                                    userId,
                                    name:
                                      member.profile?.display_name || "User",
                                  }),
                                className: "bg-destructive",
                              });
                            }

                            return (
                              <SwipeableCard
                                key={userId}
                                actions={memberSwipeActions}
                                enabled={memberSwipeActions.length > 0}
                                className="border shadow-sm"
                              >
                                <CardContent
                                  className="p-3.5 flex items-center gap-3 cursor-pointer"
                                  onClick={() =>
                                    onSelectMember({
                                      userId,
                                      displayName:
                                        member.profile?.display_name ||
                                        "Unknown User",
                                      avatarUrl: member.profile?.avatar_url,
                                      roles: member.roles || [],
                                    })
                                  }
                                >
                                  <Avatar className="h-8 w-8 shrink-0">
                                    <AvatarImage
                                      src={
                                        member.profile?.avatar_url || undefined
                                      }
                                    />
                                    <AvatarFallback className="bg-primary/20 text-primary text-sm">
                                      {member.profile?.display_name
                                        ?.charAt(0)
                                        ?.toUpperCase() || "?"}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm truncate">
                                      {member.profile?.display_name ||
                                        "Unknown User"}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {member.roles?.map((roleItem) => {
                                      const roleLabels: Record<string, string> =
                                        {
                                          app_admin: "App Admin",
                                          club_admin: "Club Admin",
                                          team_admin: "Team Admin",
                                          coach: "Coach",
                                          player: "Player",
                                          parent: "Parent",
                                          basic_user: "Member",
                                        };
                                      const roleColors: Record<string, string> =
                                        {
                                          app_admin:
                                            "bg-red-500/20 text-red-400 border-red-500/30",
                                          club_admin:
                                            "bg-purple-500/20 text-purple-400 border-purple-500/30",
                                          team_admin:
                                            "bg-blue-500/20 text-blue-400 border-blue-500/30",
                                          coach:
                                            "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
                                          player:
                                            "bg-amber-500/20 text-amber-400 border-amber-500/30",
                                          parent:
                                            "bg-pink-500/20 text-pink-400 border-pink-500/30",
                                          basic_user:
                                            "bg-muted text-muted-foreground border-border",
                                        };
                                      return (
                                        <Badge
                                          key={roleItem.id}
                                          variant="outline"
                                          className={`text-[10px] border px-1.5 py-0 h-4 ${roleColors[roleItem.role] || roleColors.basic_user}`}
                                        >
                                          {roleLabels[roleItem.role] ||
                                            "Member"}
                                        </Badge>
                                      );
                                    })}
                                  </div>
                                </CardContent>
                              </SwipeableCard>
                            );
                          })}
                          {/* Pending invites at bottom of each role group */}
                          {rolePending.length > 0 &&
                            (memberRoleFilter === "all" ||
                              memberRoleFilter === role) && (
                              <PendingInvitesList
                                invites={rolePending}
                                teamId={teamId}
                                isAdmin={isAdmin || isClubAdmin}
                              />
                            )}
                        </div>
                      </div>
                    );
                  });
              })()}
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
