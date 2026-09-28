import { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Crown, Check, Users, Shield, Sparkles, ChevronLeft, ChevronRight, Search, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface CreateGroupDialogProps {
  clubId?: string;
  teamId?: string;
  miniLeagueId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * "role" (default) — current role-first behavior.
   * "team" — team scope is the primary control; roles are an optional filter
   * tucked into a collapsed "Filter roles" section. Group name is auto-suggested
   * from the selected team.
   */
  groupType?: "role" | "team";
}

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "league_admin", label: "League Admins" },
  { value: "committee_member", label: "Committee" },
  { value: "team_admin", label: "Team Admins" },
  { value: "coach", label: "Coaches" },
  { value: "parent", label: "Parents" },
  { value: "player", label: "Players" },
];

export default function CreateGroupDialog({
  clubId,
  teamId,
  miniLeagueId,
  open: controlledOpen,
  onOpenChange,
  groupType = "role",
}: CreateGroupDialogProps) {
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<AppRole[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(teamId || "");
  const [selectedMiniLeagueId, setSelectedMiniLeagueId] = useState<string>(miniLeagueId || "");
  const [showRoleFilter, setShowRoleFilter] = useState<boolean>(false);
  const [showTeamScope, setShowTeamScope] = useState<boolean>(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [teamSearch, setTeamSearch] = useState("");

  // Use controlled or uncontrolled state
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (open: boolean) => {
    if (onOpenChange) onOpenChange(open);
    else setInternalOpen(open);
  };

  // In team mode, default to all roles included so user can create a team chat
  // without having to manually pick roles.
  useEffect(() => {
    if (groupType === "team" && isOpen && selectedRoles.length === 0) {
      setSelectedRoles(ROLE_OPTIONS.map((r) => r.value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupType, isOpen]);

  // Reset to first step whenever the dialog reopens
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setTeamSearch("");
      setShowRoleFilter(false);
      setShowTeamScope(false);
    }
  }, [isOpen]);

  // Resolve the active club context. clubId prop > active club filter.
  const resolvedClubId = clubId || activeClubFilter || null;

  // Determine what scope this group will use
  // - explicit teamId prop -> team scope (locked)
  // - explicit miniLeagueId prop -> league scope (locked)
  // - resolvedClubId -> club scope, optionally narrowed by selectedTeamId
  const isTeamScopeLocked = !!teamId;
  const isLeagueScopeLocked = !!miniLeagueId;

  // Fetch club info for context label
  const { data: clubInfo } = useQuery({
    queryKey: ["create-group-club-info", resolvedClubId, teamId, miniLeagueId],
    queryFn: async () => {
      if (teamId) {
        const { data } = await supabase
          .from("teams")
          .select("id, name, club_id, clubs!club_id(id, name)")
          .eq("id", teamId)
          .maybeSingle();
        return {
          clubId: data?.club_id || null,
          clubName: data?.clubs?.name || null,
          teamName: data?.name || null,
          leagueName: null as string | null,
        };
      }
      if (miniLeagueId) {
        const { data } = await supabase
          .from("mini_leagues")
          .select("id, name, club_id, clubs!club_id(id, name)")
          .eq("id", miniLeagueId)
          .maybeSingle();
        return {
          clubId: data?.club_id || null,
          clubName: data?.clubs?.name || null,
          teamName: null,
          leagueName: data?.name || null,
        };
      }
      if (resolvedClubId) {
        const { data } = await supabase
          .from("clubs")
          .select("id, name")
          .eq("id", resolvedClubId)
          .maybeSingle();
        return {
          clubId: data?.id || null,
          clubName: data?.name || null,
          teamName: null,
          leagueName: null,
        };
      }
      return { clubId: null, clubName: null, teamName: null, leagueName: null };
    },
    enabled: isOpen && !!(resolvedClubId || teamId || miniLeagueId),
  });

  // Fetch club Pro status (for club-wide groups)
  const { data: clubHasPro } = useQuery({
    queryKey: ["create-group-club-pro", clubInfo?.clubId],
    queryFn: async () => {
      if (!clubInfo?.clubId) return false;
      const { data } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .eq("club_id", clubInfo.clubId)
        .maybeSingle();
      return !!(data?.is_pro || data?.is_pro_football || data?.admin_pro_override || data?.admin_pro_football_override);
    },
    enabled: isOpen && !!clubInfo?.clubId,
  });

  // Fetch teams for the active club (for the Teams chip section)
  const { data: clubTeams = [] } = useQuery({
    queryKey: ["create-group-club-teams", clubInfo?.clubId],
    queryFn: async () => {
      if (!clubInfo?.clubId) return [];
      const { data } = await supabase
        .from("teams")
        .select("id, name")
        .eq("club_id", clubInfo.clubId)
        .order("name");
      return data || [];
    },
    enabled: isOpen && !!clubInfo?.clubId && !isTeamScopeLocked && !isLeagueScopeLocked,
  });

  // Fetch member counts per role within the active club scope
  const { data: roleCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["create-group-role-counts", clubInfo?.clubId, selectedTeamId, teamId, miniLeagueId],
    queryFn: async () => {
      const counts: Record<string, number> = {};

      // If a specific team is selected (or locked), count via that team's user_roles
      const scopeTeamId = teamId || (selectedTeamId || null);
      if (scopeTeamId) {
        const { data } = await supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("team_id", scopeTeamId);
        const seen = new Map<string, Set<string>>();
        (data || []).forEach((r: any) => {
          if (!seen.has(r.role)) seen.set(r.role, new Set());
          seen.get(r.role)!.add(r.user_id);
        });
        seen.forEach((set, role) => { counts[role] = set.size; });
        return counts;
      }

      if (miniLeagueId) {
        // mini-league member roles
        const { data } = await (supabase as any)
          .from("user_roles")
          .select("user_id, role")
          .eq("mini_league_id", miniLeagueId);
        const seen = new Map<string, Set<string>>();
        ((data as any[]) || []).forEach((r: any) => {
          if (!seen.has(r.role)) seen.set(r.role, new Set());
          seen.get(r.role)!.add(r.user_id);
        });
        seen.forEach((set, role) => { counts[role] = set.size; });
        return counts;
      }

      if (!clubInfo?.clubId) return counts;

      // Club scope: union of direct club roles + roles on any team in the club
      const [{ data: clubRows }, { data: teams }] = await Promise.all([
        supabase.from("user_roles").select("user_id, role").eq("club_id", clubInfo.clubId),
        supabase.from("teams").select("id").eq("club_id", clubInfo.clubId),
      ]);

      const teamIds = (teams || []).map(t => t.id);
      let teamRows: any[] = [];
      if (teamIds.length > 0) {
        const { data } = await supabase
          .from("user_roles")
          .select("user_id, role")
          .in("team_id", teamIds);
        teamRows = data || [];
      }

      const seen = new Map<string, Set<string>>();
      [...(clubRows || []), ...teamRows].forEach((r: any) => {
        if (!seen.has(r.role)) seen.set(r.role, new Set());
        seen.get(r.role)!.add(r.user_id);
      });
      seen.forEach((set, role) => { counts[role] = set.size; });
      return counts;
    },
    enabled: isOpen && !!(clubInfo?.clubId || teamId || miniLeagueId),
  });

  // Fetch admin mini-leagues (Pro Football) for league fallback when no clubId AND no scope
  const { data: adminMiniLeagues = [] } = useQuery({
    queryKey: ["admin-mini-leagues-for-groups", user?.id, activeClubFilter],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "app_admin", "committee_member", "coach", "team_admin"]);
      let ids = roles?.map(r => r.club_id).filter((x): x is string => !!x) || [];
      if (activeClubFilter) ids = ids.filter(id => id === activeClubFilter);
      if (ids.length === 0) return [];
      const { data: subs } = await supabase
        .from("club_subscriptions")
        .select("club_id")
        .in("club_id", ids)
        .or("is_pro_football.eq.true,admin_pro_football_override.eq.true");
      const proIds = subs?.map(s => s.club_id) || [];
      if (proIds.length === 0) return [];
      const { data } = await supabase
        .from("mini_leagues")
        .select("id, name, club_id, clubs!club_id(name)")
        .in("club_id", proIds);
      return data || [];
    },
    enabled: isOpen && !miniLeagueId && !!user,
  });

  // Estimated total selected members (union of selected roles within the chosen scope)
  const { data: selectedCount = 0 } = useQuery({
    queryKey: [
      "create-group-selected-count",
      clubInfo?.clubId,
      teamId,
      miniLeagueId,
      selectedTeamId,
      selectedRoles.join(","),
    ],
    queryFn: async () => {
      if (selectedRoles.length === 0) return 0;
      const scopeTeamId = teamId || selectedTeamId || null;

      if (scopeTeamId) {
        const { data } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("team_id", scopeTeamId)
          .in("role", selectedRoles as any);
        return new Set((data || []).map(r => r.user_id)).size;
      }
      if (miniLeagueId) {
        const { data } = await (supabase as any)
          .from("user_roles")
          .select("user_id")
          .eq("mini_league_id", miniLeagueId)
          .in("role", selectedRoles);
        return new Set(((data as any[]) || []).map((r: any) => r.user_id)).size;
      }
      if (!clubInfo?.clubId) return 0;

      const [{ data: clubRows }, { data: teams }] = await Promise.all([
        supabase.from("user_roles").select("user_id").eq("club_id", clubInfo.clubId).in("role", selectedRoles as any),
        supabase.from("teams").select("id").eq("club_id", clubInfo.clubId),
      ]);
      const teamIds = (teams || []).map(t => t.id);
      let teamRows: any[] = [];
      if (teamIds.length > 0) {
        const { data } = await supabase
          .from("user_roles")
          .select("user_id")
          .in("team_id", teamIds)
          .in("role", selectedRoles as any);
        teamRows = data || [];
      }
      return new Set(
        [...(clubRows || []), ...teamRows].map((r: any) => r.user_id)
      ).size;
    },
    enabled: isOpen && selectedRoles.length > 0,
  });

  const createGroupMutation = useMutation({
    mutationFn: async () => {
      if (!user || selectedRoles.length === 0) return;

      const finalTeamId = teamId || selectedTeamId || null;
      const finalMiniLeagueId = miniLeagueId || selectedMiniLeagueId || null;
      // Club scope only when no team / league chosen.
      // If user provided a category, treat the group as club-scoped so it
      // nests under the right vault folder — fall back to the active club.
      let finalClubId = !finalTeamId && !finalMiniLeagueId
        ? (clubId || clubInfo?.clubId || null)
        : null;
      // Detect "category-only" club attachment: the user didn't explicitly
      // pick a club/team/league, but added a category so we stamp the active
      // club purely for vault-folder linkage. These groups must NOT auto-expose
      // to club members via role mode — they stay manual + invite-only.
      const categoryOnlyClubScope =
        !finalClubId &&
        !finalTeamId &&
        !finalMiniLeagueId &&
        !!category.trim() &&
        !!clubInfo?.clubId;
      if (categoryOnlyClubScope) {
        finalClubId = clubInfo!.clubId;
      }

      if (!finalTeamId && !finalClubId && !finalMiniLeagueId) {
        throw new Error("Please pick a club, team, or league");
      }

      if (finalClubId && !clubHasPro) {
        throw new Error("Club-wide groups require a Club Pro subscription");
      }

      const { data: inserted, error } = await supabase
        .from("chat_groups")
        .insert({
          name: name.trim(),
          club_id: finalClubId,
          team_id: finalTeamId,
          mini_league_id: finalMiniLeagueId,
          // Category-only groups: no role-based fanout, no allowed_roles.
          allowed_roles: categoryOnlyClubScope ? [] : selectedRoles,
          membership_mode: categoryOnlyClubScope ? "manual" : undefined,
          created_by: user.id,
          // Only meaningful for club-scoped groups — it drives the parent
          // vault folder name (e.g. "Club Management", "Operations").
          category: finalClubId && category.trim() ? category.trim() : null,
        })
        .select("id")
        .single();

      if (error) throw error;

      // The DB trigger only auto-adds the creator when club/team/league are all
      // NULL. Category-only groups have club_id set for vault scoping, so the
      // creator must be added explicitly — otherwise the creator can't even
      // see their own group.
      if (categoryOnlyClubScope && inserted?.id) {
        await supabase.from("group_members").insert({
          group_id: inserted.id,
          user_id: user.id,
          added_by: user.id,
        });
      }
    },
    onSuccess: () => {
      toast.success("Chat group created");
      setOpen(false);
      setName("");
      setCategory("");
      setSelectedRoles([]);
      setStep(1);
      setTeamSearch("");
      setShowRoleFilter(false);
      setShowTeamScope(false);
      if (!teamId) setSelectedTeamId("");
      if (!miniLeagueId) setSelectedMiniLeagueId("");
      queryClient.invalidateQueries({ queryKey: ["chat-groups"] });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups"] });
      queryClient.invalidateQueries({ queryKey: ["messages-page"] });
    },
    onError: (error) => {
      console.error("Error creating group:", error);
      toast.error(error.message || "Failed to create chat group");
    },
  });

  const toggleRole = (role: AppRole) => {
    setSelectedRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  };

  const handleCreate = () => {
    if (!name.trim()) {
      toast.error("Give your group a name");
      return;
    }
    if (groupType === "team" && !teamId && !selectedTeamId) {
      toast.error("Pick a team");
      return;
    }
    if (selectedRoles.length === 0) {
      toast.error("Pick at least one role");
      return;
    }
    createGroupMutation.mutate();
  };

  // Decide which scope label to render
  const contextLabel = useMemo(() => {
    if (clubInfo?.teamName) return `${clubInfo.teamName} · ${clubInfo.clubName || ""}`.trim();
    if (clubInfo?.leagueName) return `${clubInfo.leagueName} · ${clubInfo.clubName || ""}`.trim();
    if (clubInfo?.clubName) return clubInfo.clubName;
    return null;
  }, [clubInfo]);

  const showTeamPicker = !isTeamScopeLocked && !isLeagueScopeLocked && clubTeams.length > 0;
  const showLeaguePicker =
    !isTeamScopeLocked && !isLeagueScopeLocked && !resolvedClubId && adminMiniLeagues.length > 0;

  // Auto-suggest a name when a team is picked in team mode (only if user hasn't typed one)
  useEffect(() => {
    if (groupType !== "team" || !isOpen) return;
    if (!selectedTeamId) return;
    const t = clubTeams.find((ct) => ct.id === selectedTeamId);
    if (!t) return;
    setName((prev) => (prev.trim() ? prev : `${t.name} chat`));
  }, [groupType, isOpen, selectedTeamId, clubTeams]);

  const isTeamMode = groupType === "team";

  const dialogContent = (
    <ResponsiveDialog open={isOpen} onOpenChange={setOpen}>
      <ResponsiveDialogContent className="sm:max-w-lg" fullScreen>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            {isTeamMode ? <Users className="h-4 w-4 text-primary" /> : <Sparkles className="h-4 w-4 text-primary" />}
            {isTeamMode ? "New Team Group" : "New Role-Based Group"}
          </ResponsiveDialogTitle>
          {contextLabel && (
            <p className="text-xs text-muted-foreground pt-1">
              {isTeamMode ? "Creating team chat in " : "Creating group in "}
              <span className="font-medium text-foreground">{contextLabel}</span>
            </p>
          )}
          {/* Step indicator */}
          <div className="flex items-center gap-2 pt-3">
            {[1, 2].map((n) => (
              <div
                key={n}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  step >= n ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
            <span className="text-[10px] text-muted-foreground tabular-nums ml-1">
              {step}/2
            </span>
          </div>
          <p className="text-xs text-muted-foreground pt-2">
            {step === 1
              ? isTeamMode
                ? "Step 1 — Pick a team"
                : "Step 1 — Pick who's included"
              : "Step 2 — Name your group"}
          </p>
        </ResponsiveDialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5 py-3 px-1">
          {step === 1 && !isTeamMode && (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Shield className="h-3 w-3" />
                  Roles
                </Label>
                <span className="text-[10px] text-muted-foreground">Multi-select</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {ROLE_OPTIONS.map((role) => {
                  const isSelected = selectedRoles.includes(role.value);
                  const count = roleCounts[role.value] ?? 0;
                  if (count === 0 && !isSelected) return null;
                  return (
                    <button
                      key={role.value}
                      type="button"
                      onClick={() => toggleRole(role.value)}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium",
                        "border transition-all duration-200 active:scale-[0.97] touch-manipulation",
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20"
                          : "bg-card text-foreground border-border hover:border-primary/40 hover:bg-accent/40"
                      )}
                    >
                      {isSelected && <Check className="h-3.5 w-3.5 -ml-0.5" />}
                      <span>{role.label}</span>
                      <span
                        className={cn(
                          "text-[11px] font-semibold rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center",
                          isSelected
                            ? "bg-primary-foreground/20 text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
                {Object.keys(roleCounts).length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">
                    No members found in this scope yet.
                  </p>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                You can narrow this to a single team in the next step.
              </p>
            </section>
          )}

          {step === 1 && isTeamMode && showTeamPicker && (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Users className="h-3 w-3" />
                  Pick a team
                </Label>
                <span className="text-[10px] text-muted-foreground">Required</span>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={teamSearch}
                  onChange={(e) => setTeamSearch(e.target.value)}
                  placeholder="Search teams"
                  className="h-11 rounded-xl pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {clubTeams
                  .filter((t) =>
                    teamSearch.trim()
                      ? t.name.toLowerCase().includes(teamSearch.trim().toLowerCase())
                      : true
                  )
                  .map((t) => {
                    const isSelected = selectedTeamId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTeamId(isSelected ? "" : t.id)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium",
                          "border transition-all duration-200 active:scale-[0.97] touch-manipulation",
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20"
                            : "bg-card text-foreground border-border hover:border-primary/40 hover:bg-accent/40"
                        )}
                      >
                        {isSelected && <Check className="h-3.5 w-3.5 -ml-0.5" />}
                        {t.name}
                      </button>
                    );
                  })}
              </div>
            </section>
          )}

          {step === 2 && (
            <>
              <section className="space-y-2">
                <Label htmlFor="group-name" className="text-xs uppercase tracking-wide text-muted-foreground">
                  Group name
                </Label>
                <Input
                  id="group-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Coaches huddle, U10 Parents"
                  className="h-11 rounded-xl"
                  maxLength={60}
                  autoFocus
                />
              </section>

              {/* Category — only meaningful for club-wide groups (no team/league).
                  Drives the parent folder name in the club File Vault. */}
              {!isTeamMode && !teamId && !selectedTeamId && !miniLeagueId && !selectedMiniLeagueId && (
                <section className="space-y-2">
                  <Label htmlFor="group-category" className="text-xs uppercase tracking-wide text-muted-foreground">
                    Category
                  </Label>
                  <Input
                    id="group-category"
                    list="group-category-suggestions"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g. Club Management, Operations"
                    className="h-11 rounded-xl"
                    maxLength={60}
                  />
                  <datalist id="group-category-suggestions">
                    <option value="Club Management" />
                    <option value="Operations" />
                    <option value="Coaching" />
                    <option value="Finance" />
                    <option value="Uniform" />
                    <option value="Events" />
                    <option value="Sponsorship" />
                    <option value="Volunteers" />
                  </datalist>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Groups its File Vault folder under this category. Leave blank to use "General".
                  </p>
                </section>
              )}

              {/* League fallback (rare) */}
              {showLeaguePicker && (
                <section className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    League
                  </Label>
                  <Select value={selectedMiniLeagueId} onValueChange={setSelectedMiniLeagueId}>
                    <SelectTrigger className="w-full rounded-xl">
                      <SelectValue placeholder="Pick a league (optional)" />
                    </SelectTrigger>
                    <SelectContent
                      className="z-[100000]"
                      position="popper"
                      portal={false}
                      onPointerDownOutside={(e) => e.preventDefault()}
                    >
                      <SelectItem value="">None</SelectItem>
                      {adminMiniLeagues.map((l: any) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </section>
              )}

              {/* Live summary card */}
              <section
                className={cn(
                  "rounded-2xl border p-3.5 transition-all",
                  selectedRoles.length > 0
                    ? "border-primary/30 bg-primary/5"
                    : "border-dashed border-border bg-muted/30"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={cn(
                      "h-9 w-9 rounded-full flex items-center justify-center shrink-0",
                      selectedRoles.length > 0
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Users className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-tight">
                      {selectedCount} {selectedCount === 1 ? "member" : "members"} selected
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {isTeamMode
                        ? clubTeams.find((t) => t.id === (teamId || selectedTeamId))?.name || "Team"
                        : selectedTeamId
                        ? clubTeams.find((t) => t.id === selectedTeamId)?.name
                        : "Whole club"}
                      {" · "}
                      {selectedRoles.length === ROLE_OPTIONS.length
                        ? "All roles"
                        : selectedRoles
                            .map((r) => ROLE_OPTIONS.find((o) => o.value === r)?.label)
                            .filter(Boolean)
                            .join(" + ") || "No roles"}
                    </p>
                  </div>
                </div>
              </section>

              {/* Advanced: narrow scope (role mode) or filter roles (team mode) */}
              {!isTeamMode && showTeamPicker && (
                <section className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowTeamScope((v) => !v)}
                    className="w-full flex items-center justify-between rounded-xl border border-dashed border-border px-4 py-3 text-left active:scale-[0.99] transition-transform touch-manipulation hover:border-primary/40 hover:bg-accent/30"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">Narrow to a team</span>
                      <span className="text-xs text-muted-foreground">Optional</span>
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {selectedTeamId
                        ? clubTeams.find((t) => t.id === selectedTeamId)?.name
                        : "Whole club"}
                      <ChevronDown className={cn("h-4 w-4 transition-transform", showTeamScope && "rotate-180")} />
                    </span>
                  </button>
                  {showTeamScope && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setSelectedTeamId("")}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium border transition-all active:scale-[0.97]",
                          selectedTeamId === ""
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-card text-foreground border-border hover:border-primary/40"
                        )}
                      >
                        {selectedTeamId === "" && <Check className="h-3.5 w-3.5 -ml-0.5" />}
                        Whole club
                      </button>
                      {clubTeams.map((t) => {
                        const isSelected = selectedTeamId === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setSelectedTeamId(isSelected ? "" : t.id)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium border transition-all active:scale-[0.97]",
                              isSelected
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-card text-foreground border-border hover:border-primary/40"
                            )}
                          >
                            {isSelected && <Check className="h-3.5 w-3.5 -ml-0.5" />}
                            {t.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {!selectedTeamId && !clubHasPro && (
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Crown className="h-3 w-3" />
                      Whole-club groups need Club Pro. Pick a team to create now.
                    </p>
                  )}
                </section>
              )}

              {isTeamMode && (
                <section className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowRoleFilter((v) => !v)}
                    className="w-full flex items-center justify-between rounded-xl border border-dashed border-border px-4 py-3 text-left active:scale-[0.99] transition-transform touch-manipulation hover:border-primary/40 hover:bg-accent/30"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <Shield className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">Filter roles</span>
                      <span className="text-xs text-muted-foreground">Optional</span>
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {selectedRoles.length === ROLE_OPTIONS.length
                        ? "All roles"
                        : `${selectedRoles.length} role${selectedRoles.length === 1 ? "" : "s"}`}
                      <ChevronDown className={cn("h-4 w-4 transition-transform", showRoleFilter && "rotate-180")} />
                    </span>
                  </button>
                  {showRoleFilter && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {ROLE_OPTIONS.map((role) => {
                        const isSelected = selectedRoles.includes(role.value);
                        const count = roleCounts[role.value] ?? 0;
                        if (count === 0 && !isSelected) return null;
                        return (
                          <button
                            key={role.value}
                            type="button"
                            onClick={() => toggleRole(role.value)}
                            className={cn(
                              "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium border transition-all active:scale-[0.97]",
                              isSelected
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-card text-foreground border-border hover:border-primary/40"
                            )}
                          >
                            {isSelected && <Check className="h-3.5 w-3.5 -ml-0.5" />}
                            <span>{role.label}</span>
                            <span
                              className={cn(
                                "text-[11px] font-semibold rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center",
                                isSelected
                                  ? "bg-primary-foreground/20 text-primary-foreground"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>

        <ResponsiveDialogFooter>
          {step === 1 ? (
            <>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                className="flex-1 sm:flex-none"
              >
                Cancel
              </Button>
              <Button
                onClick={() => setStep(2)}
                disabled={
                  isTeamMode
                    ? !(teamId || selectedTeamId)
                    : selectedRoles.length === 0
                }
                className="flex-1 sm:flex-none gap-2"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                className="flex-1 sm:flex-none gap-2"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={handleCreate}
                disabled={
                  createGroupMutation.isPending ||
                  !name.trim() ||
                  selectedRoles.length === 0
                }
                className="flex-1 sm:flex-none gap-2"
              >
                {createGroupMutation.isPending ? "Creating..." : "Create Group"}
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );

  if (controlledOpen === undefined) {
    return (
      <>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          New Group
        </Button>
        {dialogContent}
      </>
    );
  }

  return dialogContent;
}
