import {
  AlertTriangle,
  Baby,
  CheckCircle2,
  ChevronDown,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ParentInviteFields, type ParentInviteSuggestion } from "@/components/membership/ParentInviteFields";
import {
  type BulkChild,
  type ChildMatchCandidate,
  type SecondParentProfile,
} from "@/components/members/ChildAndSecondGuardianFields";

type TeamRole = "player" | "parent" | "coach" | "team_admin";

interface ExistingUserOption {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface BulkMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  children: BulkChild[];
  selectedUser?: ExistingUserOption | null;
  secondParentName?: string;
  secondParentEmail?: string;
  secondParentSearch?: string;
  selectedSecondParent?: SecondParentProfile | null;
}

interface BulkSearchResult extends ExistingUserOption {
  invited_email?: string | null;
  isPendingInvite?: boolean;
}

interface RoleOption {
  value: TeamRole;
  label: string;
  color: string;
}

interface AddTeamMemberBulkMemberListProps {
  bulkMembers: BulkMember[];
  roleOptions: RoleOption[];
  bulkSearchMap: Map<string, BulkSearchResult[]>;
  bulkSecondParentMap: Map<string, ExistingUserOption[]>;
  memberNameMatchesExisting: (name: string) => ExistingUserOption | null | undefined;
  findMatchingChildren: (name: string) => ChildMatchCandidate[];
  setBulkMembers: (members: BulkMember[]) => void;
  updateBulkMember: (id: string, field: "name" | "email" | "role", value: string) => void;
  selectBulkExistingUser: (memberId: string, selected: ExistingUserOption) => void;
  updateBulkMemberRole: (id: string, role: TeamRole) => void;
  addChildToMember: (memberId: string) => void;
  removeChildFromMember: (memberId: string, childId: string) => void;
  updateChild: (memberId: string, childId: string, field: "name" | "yearOfBirth" | "jerseyNumber", value: string) => void;
  removeBulkMemberRow: (id: string) => void;
}

export function AddTeamMemberBulkMemberList({
  bulkMembers,
  roleOptions,
  bulkSearchMap,
  bulkSecondParentMap,
  memberNameMatchesExisting,
  findMatchingChildren,
  setBulkMembers,
  updateBulkMember,
  selectBulkExistingUser,
  updateBulkMemberRole,
  addChildToMember,
  removeChildFromMember,
  updateChild,
  removeBulkMemberRow,
}: AddTeamMemberBulkMemberListProps) {
  const updateMembers = (memberId: string, updater: (member: BulkMember) => BulkMember) => {
    setBulkMembers(bulkMembers.map((member) => (member.id === memberId ? updater(member) : member)));
  };

  return (
    <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-1">
      {bulkMembers.map((member) => {
        const bulkMatches = member.selectedUser ? [] : (bulkSearchMap.get(member.name.trim()) || []);
        const existingMemberMatch = member.role !== "parent" && !member.selectedUser
          ? memberNameMatchesExisting(member.name)
          : null;
        const secondParentSearch = (member.secondParentSearch || "").trim();
        const secondParentSuggestions = secondParentSearch.length >= 2
          ? (bulkSecondParentMap.get(secondParentSearch) || [])
              .filter((profile) => profile.id !== member.selectedUser?.id)
              .map((profile): ParentInviteSuggestion => ({
                id: profile.id,
                name: profile.display_name || "Unknown",
                avatarUrl: profile.avatar_url,
              }))
          : [];

        return (
          <div key={member.id} className="p-3 rounded-lg border bg-muted/20 space-y-3">
            <div className="flex gap-2 items-start">
              <div className="flex-1 space-y-2">
                {member.selectedUser ? (
                  <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={member.selectedUser.avatar_url || undefined} />
                      <AvatarFallback className="bg-primary/20 text-primary text-sm">
                        {member.selectedUser.display_name?.[0]?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{member.selectedUser.display_name || member.name}</p>
                      <p className="text-xs text-muted-foreground">Existing user • Joins team immediately</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => updateBulkMember(member.id, "name", "")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by name or email, or type new"
                        value={member.name}
                        onChange={(event) => updateBulkMember(member.id, "name", event.target.value)}
                        className="pl-10"
                      />
                    </div>

                    {member.name.trim().length >= 2 && bulkMatches.length > 0 && (
                      <div className="space-y-1 rounded-lg border bg-muted/30 p-2">
                        {bulkMatches.map((result) => (
                          <button
                            key={result.id}
                            type="button"
                            onClick={() => {
                              if (result.isPendingInvite && result.id.toString().startsWith("pending-")) {
                                updateMembers(member.id, (current) => ({
                                  ...current,
                                  name: result.display_name || "",
                                  email: result.invited_email || "",
                                  selectedUser: null,
                                }));
                                return;
                              }

                              selectBulkExistingUser(member.id, result);
                            }}
                            className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-background"
                          >
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={result.avatar_url || undefined} />
                              <AvatarFallback className="bg-primary/20 text-primary text-sm">
                                {result.display_name?.[0]?.toUpperCase() || "?"}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 flex items-center gap-2">
                              <span className="text-sm font-medium">{result.display_name || "Unknown"}</span>
                              {result.isPendingInvite && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-blue-500/30 text-blue-600">
                                  Pending
                                </Badge>
                              )}
                            </div>
                          </button>
                        ))}
                        <p className="px-2 pt-1 text-xs text-muted-foreground">
                          Or keep typing to add a new member by name
                        </p>
                      </div>
                    )}

                    {member.name.trim().length >= 2 && bulkMatches.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No existing users found — this will be added as a new invite
                      </p>
                    )}

                    {existingMemberMatch && (
                      <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          <strong>{existingMemberMatch.display_name}</strong> is already a member of this team.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {!member.selectedUser && (
                  <Input
                    type="email"
                    placeholder="Email (optional)"
                    value={member.email}
                    onChange={(event) => updateBulkMember(member.id, "email", event.target.value)}
                  />
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="mt-1"
                onClick={() => removeBulkMemberRow(member.id)}
                disabled={bulkMembers.length === 1}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {roleOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateBulkMemberRole(member.id, option.value)}
                  className={`px-2 py-1 text-xs rounded-md transition-all border ${
                    member.role === option.value
                      ? option.color + " border-current"
                      : "bg-muted/50 text-muted-foreground border-transparent hover:border-muted-foreground/30"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {member.role === "parent" && (
              <div className="space-y-2 pl-3 border-l-2 border-primary/30">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-primary flex items-center gap-1">
                    <Baby className="h-3 w-3" />
                    Children
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => addChildToMember(member.id)}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Child
                  </Button>
                </div>

                {member.children.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Add children to register them with this parent
                  </p>
                )}

                {member.children.map((child) => {
                  const bulkChildMatches = !child.existingChildId && !child.confirmedNew
                    ? findMatchingChildren(child.name)
                    : [];
                  const topMatch = bulkChildMatches[0];

                  return (
                    <div key={child.id} className="space-y-1">
                      <div className="flex gap-2 items-center">
                        <Input
                          placeholder="Child's name"
                          value={child.name}
                          onChange={(event) => updateChild(member.id, child.id, "name", event.target.value)}
                          className={`h-8 text-sm flex-1 ${child.existingChildId ? "border-amber-500/50" : ""}`}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => removeChildFromMember(member.id, child.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      <Collapsible defaultOpen={!!(child.jerseyNumber || child.yearOfBirth)}>
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="group flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ChevronDown className="h-3 w-3 transition-transform group-data-[state=closed]:-rotate-90" />
                            <span className="italic">Add details now (optional)</span>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2">
                          <div className="flex gap-2">
                            <Input
                              placeholder="Jersey #"
                              value={child.jerseyNumber}
                              onChange={(event) => updateChild(member.id, child.id, "jerseyNumber", event.target.value.replace(/\D/g, "").slice(0, 2))}
                              className="h-9 text-sm w-24"
                              maxLength={2}
                              inputMode="numeric"
                            />
                            <Input
                              placeholder="Birth year"
                              value={child.yearOfBirth}
                              onChange={(event) => updateChild(member.id, child.id, "yearOfBirth", event.target.value)}
                              className="h-9 text-sm w-28"
                              maxLength={4}
                            />
                          </div>
                          <p className="text-[10px] text-muted-foreground italic mt-1.5 pl-0.5">
                            Parent can complete this later
                          </p>
                        </CollapsibleContent>
                      </Collapsible>
                      {child.existingChildId && (
                        <p className="text-[10px] text-emerald-600 pl-1 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Linked to existing child ({child.existingChildParentName || "existing parent"})
                        </p>
                      )}
                      {child.pendingInviteId && !child.existingChildId && (
                        <p className="text-[10px] text-blue-600 pl-1 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Pending invite (parent: {child.pendingParentName}) — won't create duplicate
                        </p>
                      )}
                      {topMatch && child.name.trim().length >= 3 && (
                        <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <p className="text-xs text-amber-700 dark:text-amber-300">
                              <strong>{topMatch.name}</strong>{" "}
                              {topMatch.isPending
                                ? <>has a pending invite (parent: {topMatch.parent_name}). Same child?</>
                                : <>already exists (parent: {topMatch.parent_name}). Link to them?</>}
                            </p>
                            <div className="flex gap-2 mt-1.5">
                              {topMatch.isPending ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-[10px] px-2 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                                  onClick={() => updateMembers(member.id, (current) => ({
                                    ...current,
                                    children: current.children.map((currentChild) =>
                                      currentChild.id === child.id
                                        ? {
                                            ...currentChild,
                                            confirmedNew: true,
                                            pendingInviteId: topMatch.inviteId,
                                            pendingParentName: topMatch.parent_name,
                                            existingChildId: undefined,
                                            existingChildParentName: undefined,
                                          }
                                        : currentChild,
                                    ),
                                  }))}
                                >
                                  Yes, same child
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-[10px] px-2 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                                  onClick={() => updateMembers(member.id, (current) => ({
                                    ...current,
                                    children: current.children.map((currentChild) =>
                                      currentChild.id === child.id
                                        ? {
                                            ...currentChild,
                                            name: topMatch.name,
                                            existingChildId: topMatch.id,
                                            existingChildParentName: topMatch.parent_name,
                                            pendingInviteId: undefined,
                                            pendingParentName: undefined,
                                            yearOfBirth: topMatch.year_of_birth?.toString() || "",
                                            confirmedNew: undefined,
                                          }
                                        : currentChild,
                                    ),
                                  }))}
                                >
                                  Link to existing
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] px-2"
                                onClick={() => updateMembers(member.id, (current) => ({
                                  ...current,
                                  children: current.children.map((currentChild) =>
                                    currentChild.id === child.id ? { ...currentChild, confirmedNew: true } : currentChild,
                                  ),
                                }))}
                              >
                                Different child
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {member.role === "parent" && member.children.length > 0 && (
              <div className="pl-3 border-l-2 border-blue-500/30">
                <ParentInviteFields
                  idPrefix={`bulk-${member.id}-second-parent`}
                  name={member.secondParentName || ""}
                  email={member.secondParentEmail || ""}
                  searchValue={member.secondParentSearch || ""}
                  nameLabel="Second Parent / Guardian (Optional)"
                  emailLabel="Guardian email (for invite)"
                  namePlaceholder="Search by name or email, or type new"
                  emailPlaceholder="Guardian's email (for invite)"
                  suggestions={secondParentSuggestions}
                  selectedSuggestion={member.selectedSecondParent ? {
                    id: member.selectedSecondParent.id,
                    name: member.selectedSecondParent.display_name || "Unknown",
                    avatarUrl: member.selectedSecondParent.avatar_url,
                  } : undefined}
                  onNameChange={(value) => updateMembers(member.id, (current) => ({
                    ...current,
                    secondParentName: value,
                    selectedSecondParent: null,
                  }))}
                  onEmailChange={(value) => updateMembers(member.id, (current) => ({
                    ...current,
                    secondParentEmail: value,
                  }))}
                  onSearchChange={(value) => updateMembers(member.id, (current) => ({
                    ...current,
                    secondParentSearch: value,
                    secondParentName: value,
                  }))}
                  onSelectSuggestion={(suggestion) => updateMembers(member.id, (current) => ({
                    ...current,
                    selectedSecondParent: {
                      id: suggestion.id,
                      display_name: suggestion.name,
                      avatar_url: suggestion.avatarUrl || null,
                    },
                    secondParentName: suggestion.name,
                    secondParentSearch: "",
                    secondParentEmail: "",
                  }))}
                  onClearSelection={() => updateMembers(member.id, (current) => ({
                    ...current,
                    selectedSecondParent: null,
                    secondParentSearch: "",
                    secondParentName: "",
                    secondParentEmail: "",
                  }))}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
