import { Baby, Users, Search, Mail, X, CheckCircle2, AlertTriangle, Plus, Trash2, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export interface BulkChild {
  id: string;
  name: string;
  yearOfBirth: string;
  jerseyNumber: string;
  existingChildId?: string; // If set, links to an existing child record instead of creating new
  existingChildParentName?: string; // Display context for existing child
  confirmedNew?: boolean; // If true, user explicitly confirmed this is a different child despite name match
  pendingInviteId?: string; // If set, child exists in a pending invite — skip creation
  pendingParentName?: string; // Display context for pending invite parent
}

export interface PendingInviteChildMatch {
  id: string;
  name: string;
  year_of_birth: number | null;
  parent_name: string;
  parent_id: string;
  isPending: true;
  inviteId: string;
}

export type ExistingClubChildRow = {
  id: string;
  name: string;
  year_of_birth: number | null;
  parent_id: string | null;
  parent_name: string;
};

export type ChildMatchCandidate =
  | (ExistingClubChildRow & { isPending: false })
  | PendingInviteChildMatch;

export interface SecondParentProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface ChildAndSecondGuardianFieldsProps {
  singleChildren: BulkChild[];
  setSingleChildren: (children: BulkChild[]) => void;
  findMatchingChildren: (name: string) => ChildMatchCandidate[];
  clubChildren: ExistingClubChildRow[];
  selectedSecondParent: SecondParentProfile | null;
  setSelectedSecondParent: (profile: SecondParentProfile | null) => void;
  secondParentSearch: string;
  setSecondParentSearch: (value: string) => void;
  secondParentName: string;
  setSecondParentName: (value: string) => void;
  secondParentEmail: string;
  setSecondParentEmail: (value: string) => void;
  filteredSecondParentResults: SecondParentProfile[];
  /** Microcopy shown under the confirmed second parent — the only textual
   * difference between the "existing user" and "new member" call sites. */
  secondParentJoinDescription: string;
}

/**
 * Shared "Child Player(s)" + "Second Parent / Guardian" fields used by both
 * the existing-user and new-member parent-role branches of
 * `AddTeamMemberSheet`. Extracted because the two call sites rendered the
 * identical 260+ line block verbatim except for this microcopy string.
 */
export function ChildAndSecondGuardianFields({
  singleChildren,
  setSingleChildren,
  findMatchingChildren,
  clubChildren,
  selectedSecondParent,
  setSelectedSecondParent,
  secondParentSearch,
  setSecondParentSearch,
  secondParentName,
  setSecondParentName,
  secondParentEmail,
  setSecondParentEmail,
  filteredSecondParentResults,
  secondParentJoinDescription,
}: ChildAndSecondGuardianFieldsProps) {
  return (
    <>
      <div className="space-y-3 p-4 rounded-xl bg-primary/5 border border-primary/20">
        <div className="flex items-center gap-2">
          <Baby className="h-4 w-4 text-primary" />
          <Label className="text-primary font-medium">Child Player(s)</Label>
        </div>

        {singleChildren.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-2">
            {singleChildren.map((child, idx) => {
              const matches = !child.existingChildId && !child.confirmedNew && !child.pendingInviteId ? findMatchingChildren(child.name) : [];
              return (
                <div key={child.id} className="space-y-1">
                  <div className="space-y-2">
                    <div className="flex gap-2 items-start">
                      <div className="flex-1 space-y-1 relative">
                        <Input
                          placeholder="Child's name"
                          value={child.name}
                          onChange={(e) => setSingleChildren(singleChildren.map(c =>
                            c.id === child.id ? { ...c, name: e.target.value, existingChildId: undefined, existingChildParentName: undefined, pendingInviteId: undefined, pendingParentName: undefined, confirmedNew: undefined } : c
                          ))}
                          className={`h-9 ${child.existingChildId || child.pendingInviteId ? 'border-emerald-500/50 bg-emerald-500/5' : ''}`}
                        />
                        {matches.length > 0 && !child.existingChildId && (
                          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-32 overflow-y-auto">
                            {matches.map(m => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => setSingleChildren(singleChildren.map(c =>
                                  c.id === child.id ? ((m as any).isPending
                                    ? { ...c, name: m.name, pendingInviteId: (m as any).inviteId, pendingParentName: m.parent_name, existingChildId: undefined, existingChildParentName: undefined, yearOfBirth: m.year_of_birth?.toString() || '', confirmedNew: true }
                                    : { ...c, name: m.name, existingChildId: m.id, existingChildParentName: m.parent_name, pendingInviteId: undefined, pendingParentName: undefined, yearOfBirth: m.year_of_birth?.toString() || '', confirmedNew: undefined }) : c
                                ))}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex justify-between items-center"
                              >
                                <span className="font-medium">{m.name}</span>
                                <span className="text-xs text-muted-foreground">{m.parent_name} {m.year_of_birth ? `· ${m.year_of_birth}` : ''}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-destructive hover:text-destructive"
                        onClick={() => setSingleChildren(singleChildren.filter(c => c.id !== child.id))}
                      >
                        <Trash2 className="h-4 w-4" />
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
                        <div className="flex gap-2 pl-0">
                          <div className="flex-1">
                            <Input
                              placeholder="Jersey #"
                              value={child.jerseyNumber}
                              onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, "").slice(0, 2);
                                setSingleChildren(singleChildren.map(c =>
                                  c.id === child.id ? { ...c, jerseyNumber: val } : c
                                ));
                              }}
                              className="h-10 text-sm"
                              maxLength={2}
                              inputMode="numeric"
                            />
                          </div>
                          <div className="flex-1">
                            <select
                              value={child.existingChildId ? (clubChildren.find(c => c.id === child.existingChildId)?.year_of_birth?.toString() || '') : child.yearOfBirth}
                              onChange={(e) => {
                                setSingleChildren(singleChildren.map(c =>
                                  c.id === child.id ? { ...c, yearOfBirth: e.target.value } : c
                                ));
                              }}
                              disabled={!!child.existingChildId}
                              className="h-10 w-full text-sm rounded-md border border-input bg-background px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                            >
                              <option value="">Birth year</option>
                              {Array.from({ length: 20 }, (_, i) => new Date().getFullYear() - 3 - i).map(year => (
                                <option key={year} value={year.toString()}>{year}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground italic mt-1.5 pl-0.5">
                          Parent can complete this later
                        </p>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                  {child.existingChildId && (
                    <p className="text-xs text-emerald-600 flex items-center gap-1 pl-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Linked to existing child ({child.existingChildParentName || 'existing parent'})
                    </p>
                  )}
                  {child.pendingInviteId && !child.existingChildId && (
                    <p className="text-xs text-blue-600 flex items-center gap-1 pl-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Pending invite (parent: {child.pendingParentName})
                    </p>
                  )}
                  {!child.existingChildId && !child.confirmedNew && matches.length > 0 && child.name.trim().length >= 3 && (
                    <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          <strong>{matches[0].name}</strong>{' '}
                          {(matches[0] as any).isPending
                            ? <>has a pending invite (parent: {matches[0].parent_name}). Same child?</>
                            : <>already exists (parent: {matches[0].parent_name}). Link to them?</>
                          }
                        </p>
                        <div className="flex gap-2 mt-1.5">
                          {(matches[0] as any).isPending ? (
                            <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] px-2 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                              onClick={() => setSingleChildren(singleChildren.map(c =>
                                c.id === child.id ? { ...c, confirmedNew: true, pendingInviteId: (matches[0] as any).inviteId, pendingParentName: matches[0].parent_name, existingChildId: undefined, existingChildParentName: undefined } : c
                              ))}
                            >
                              Yes, same child
                            </Button>
                          ) : (
                            <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] px-2 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                              onClick={() => setSingleChildren(singleChildren.map(c =>
                                c.id === child.id ? { ...c, name: matches[0].name, existingChildId: matches[0].id, existingChildParentName: matches[0].parent_name, yearOfBirth: matches[0].year_of_birth?.toString() || '', confirmedNew: undefined } : c
                              ))}
                            >
                              Link to existing
                            </Button>
                          )}
                          <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                            onClick={() => setSingleChildren(singleChildren.map(c =>
                              c.id === child.id ? { ...c, confirmedNew: true } : c
                            ))}
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
            <button
              type="button"
              onClick={() => setSingleChildren([...singleChildren, { id: crypto.randomUUID(), name: "", yearOfBirth: "", jerseyNumber: "" }])}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors mt-1"
            >
              <Plus className="h-3.5 w-3.5" />
              Add another child
            </button>
          </div>
        )}
      </div>

      {singleChildren.length > 0 && (
        <div className="space-y-3 p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Optional</p>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-600" />
            <Label className="text-blue-600 font-medium">Second Parent / Guardian</Label>
          </div>

          {selectedSecondParent ? (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <Avatar className="h-8 w-8">
                <AvatarImage src={selectedSecondParent.avatar_url || undefined} />
                <AvatarFallback className="bg-primary/20 text-primary text-xs">
                  {selectedSecondParent.display_name?.[0]?.toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="text-sm font-medium">{selectedSecondParent.display_name}</p>
                <p className="text-xs text-muted-foreground">{secondParentJoinDescription}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                setSelectedSecondParent(null);
                setSecondParentSearch("");
              }}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email, or type new"
                  value={secondParentSearch || secondParentName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSecondParentSearch(val);
                    setSecondParentName(val);
                  }}
                  className="h-9 pl-10"
                />
              </div>

              {filteredSecondParentResults.length > 0 && secondParentSearch.length >= 2 && (
                <div className="border rounded-lg overflow-hidden divide-y">
                  {filteredSecondParentResults.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className="w-full flex items-center gap-3 p-2.5 hover:bg-accent/50 transition-colors text-left"
                      onClick={() => {
                        setSelectedSecondParent(user);
                        setSecondParentName(user.display_name || "");
                        setSecondParentSearch("");
                        setSecondParentEmail("");
                      }}
                    >
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={user.avatar_url || undefined} />
                        <AvatarFallback className="bg-muted text-xs">
                          {user.display_name?.[0]?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{user.display_name}</span>
                    </button>
                  ))}
                </div>
              )}

              {secondParentName.trim() && !selectedSecondParent && (
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="Second parent's email"
                    value={secondParentEmail}
                    onChange={(e) => setSecondParentEmail(e.target.value)}
                    className="h-9 pl-10"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
