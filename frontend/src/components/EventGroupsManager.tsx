import { useState, Suspense, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Wand2, Loader2, X, Copy, Shirt, RefreshCw, Flame, MoreHorizontal, ChevronDown, ArrowRightLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { hasGameBoardSupport } from "@/lib/sportDetection";

import type { Json } from "@/integrations/supabase/types";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { QuickSetupDutyDialog } from "@/components/QuickSetupDutyDialog";
import { ManualMatchDialog } from "@/components/ManualMatchDialog";
import { EventGroupCard, type EventGroup, type EventGroupDuty, type GroupPlayer, type SwapSource } from "@/components/events/EventGroupCard";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

// Lazy load PitchBoard for performance
const PitchBoard = lazyWithRetry(() => import("@/components/pitch/PitchBoard"));
const MatchDutiesDialog = lazyWithRetry(() => import("@/components/MatchDutiesDialog").then(m => ({ default: m.MatchDutiesDialog })));

// Default bib color pairs when league has no custom colors
const DEFAULT_BIB_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#f97316", "#a855f7"];

// Get a pair of contrasting colors for a match from available colors
const getMatchColors = (index: number, availableColors: string[]): { teamA: string; teamB: string } => {
  // Filter out invalid/empty/white colors
  const validColors = availableColors.filter(c => c && c.trim() !== '' && c.toLowerCase() !== '#ffffff' && c.toLowerCase() !== '#fff' && c !== 'transparent');
  const colors = validColors.length >= 2 ? validColors : DEFAULT_BIB_COLORS;
  const colorIndex = (index * 2) % colors.length;
  const teamAColor = colors[colorIndex];
  const teamBColor = colors[(colorIndex + 1) % colors.length];
  return { teamA: teamAColor, teamB: teamBColor };
};

interface EventGroupsManagerProps {
  eventId: string;
  miniLeagueId: string;
  isAdmin: boolean;
  playerOverrides?: Record<string, boolean>;
}

interface MiniLeaguePlayer {
  id: string;
  name: string;
  ability_rating: number;
  parent_user_id: string | null;
}


export function EventGroupsManager({ eventId, miniLeagueId, isAdmin, playerOverrides = {} }: EventGroupsManagerProps) {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAutoGenOpen, setIsAutoGenOpen] = useState(false);
  const [isCopyPreviousOpen, setIsCopyPreviousOpen] = useState(false);
  const [numGroups, setNumGroups] = useState(2);
  const [playersPerTeam, setPlayersPerTeam] = useState(6);
  const [abilityMode, setAbilityMode] = useState<"similar" | "mixed">("similar");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedPreviousEventId, setSelectedPreviousEventId] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isQuickSetupOpen, setIsQuickSetupOpen] = useState(false);
  
  // Tap-to-swap state
  const [swapSource, setSwapSource] = useState<SwapSource | null>(null);
  
  // State for direct pitch board and duties opening
  const [activePitchBoardGroup, setActivePitchBoardGroup] = useState<EventGroup | null>(null);
  const [activeDutiesGroup, setActiveDutiesGroup] = useState<EventGroup | null>(null);

  // Fetch event groups
  const { data: groups, isLoading, refetch: refetchGroups } = useQuery({
    queryKey: ["event-groups", eventId],
    queryFn: async () => {
      const { data: groupsData, error } = await supabase
        .from("event_groups")
        .select("*")
        .eq("event_id", eventId)
        .order("display_order");
      if (error) throw error;

      const groupsWithPlayers: EventGroup[] = [];
      for (const group of groupsData || []) {
        const { data: playerLinks } = await supabase
          .from("event_group_players")
          .select("player_id, team")
          .eq("group_id", group.id);
        
        const playerIds = playerLinks?.map(p => p.player_id) || [];
        let players: GroupPlayer[] = [];
        
        if (playerIds.length > 0) {
          const { data: playersData } = await supabase
            .from("mini_league_players")
            .select("id, name, ability_rating")
            .in("id", playerIds);
          
          players = (playersData || []).map(p => ({
            ...p,
            ability_rating: p.ability_rating || 3,
            team: playerLinks?.find(pl => pl.player_id === p.id)?.team as "a" | "b" | null,
          }));
        }

        groupsWithPlayers.push({
          ...group,
          team_a_color: group.team_a_color || "#ef4444",
          team_b_color: group.team_b_color || "#3b82f6",
          players,
        });
      }
      return groupsWithPlayers;
    },
    enabled: !!eventId,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Fetch mini league settings
  const { data: miniLeague } = useQuery({
    queryKey: ["mini-league-settings", miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_leagues")
        .select("id, name, team_size, min_players_per_side, minutes_per_half, bib_colors, show_matches_to_members, club_id, clubs:clubs!mini_leagues_club_id_fkey(sport)")
        .eq("id", miniLeagueId)
        .single();
      if (error) throw error;
      return data as unknown as { id: string; name: string; team_size: number; min_players_per_side: number; minutes_per_half: number; bib_colors: string[] | null; show_matches_to_members: boolean; club_id: string | null; clubs: { sport: string | null } | null };
    },
    enabled: !!miniLeagueId,
  });

  // The pitch board is football-only in this build — never offer it to clubs
  // playing other sports.
  const boardSupported = hasGameBoardSupport(miniLeague?.clubs?.sport);



  // Fetch mini league players
  const { data: allPlayers } = useQuery({
    queryKey: ["mini-league-players", miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("id, name, ability_rating, parent_user_id, child_id")
        .eq("mini_league_id", miniLeagueId)
        .order("ability_rating", { ascending: false });
      if (error) throw error;
      return data as (MiniLeaguePlayer & { child_id: string | null })[];
    },
    enabled: !!miniLeagueId,
  });

  // Fetch RSVPs
  const { data: eventRsvps, refetch: refetchRsvps } = useQuery({
    queryKey: ["event-rsvps-going", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rsvps")
        .select("user_id, child_id, mini_league_player_id")
        .eq("event_id", eventId)
        .eq("status", "going");
      if (error) throw error;
      return data as { user_id: string | null; child_id: string | null; mini_league_player_id: string | null }[];
    },
    enabled: !!eventId,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Fetch all duties for all groups in this event (for inline badges)
  const { data: allGroupDuties } = useQuery({
    queryKey: ["event-all-group-duties", eventId],
    queryFn: async () => {
      if (!groups || groups.length === 0) return {};
      const groupIds = groups.map(g => g.id);
      const { data, error } = await supabase
        .from("event_group_duties")
        .select("*, assignee:profiles!event_group_duties_assigned_to_fkey(display_name)")
        .in("group_id", groupIds)
        .order("created_at");
      if (error) throw error;
      // Group by group_id
      const map: Record<string, typeof data> = {};
      for (const d of data || []) {
        if (!map[d.group_id]) map[d.group_id] = [];
        map[d.group_id].push(d);
      }
      return map;
    },
    enabled: !!eventId && !!groups && groups.length > 0,
  });

  // State for quick-assign (clicking a duty badge)
  const [quickAssignDutyId, setQuickAssignDutyId] = useState<string | null>(null);

  // Map RSVPs to mini league players
  const rsvpPlayerIds = new Set<string>();
  if (eventRsvps && allPlayers) {
    eventRsvps.forEach(rsvp => {
      if (rsvp.mini_league_player_id) {
        rsvpPlayerIds.add(rsvp.mini_league_player_id);
      }
    });
    
    allPlayers.forEach(player => {
      if (player.child_id) {
        const hasChildRsvp = eventRsvps.some(r => r.child_id === player.child_id);
        if (hasChildRsvp) rsvpPlayerIds.add(player.id);
      }
      // NOTE: do NOT treat an adult parent_user_id RSVP (no child_id) as
      // covering this child. A parent saying "I'm going" only confirms the
      // parent, not the child — counting it here inflated "players ready"
      // (e.g. Maisy showing as ready because Claire RSVP'd at adult level).
    });
  }

  const availablePlayers = allPlayers?.filter(p => rsvpPlayerIds.has(p.id)) || [];

  // Get unique parent IDs from available players for duty assignment
  const parentUserIds = [...new Set(
    availablePlayers
      .map(p => p.parent_user_id)
      .filter((id): id is string => !!id)
  )];

  // Fetch parent profiles for duty assignment
  const { data: parentProfiles } = useQuery({
    queryKey: ["parent-profiles-for-duties", parentUserIds.join(",")],
    queryFn: async () => {
      if (parentUserIds.length === 0) return [];
      const { data, error } = await selectCachedProfilesByIds(parentUserIds);
      if (error) throw error;
      return (data || []).map(p => ({
        id: p.id,
        display_name: p.display_name || "Unknown",
        avatar_url: p.avatar_url,
      }));
    },
    enabled: parentUserIds.length > 0,
  });


  // Fetch previous events for copy
  const { data: previousEvents } = useQuery({
    queryKey: ["previous-mini-league-events", miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, event_date")
        .eq("mini_league_id", miniLeagueId)
        .neq("id", eventId)
        .order("event_date", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!miniLeagueId && isCopyPreviousOpen,
  });

  // Smart duty distribution: assign event-level duties to matches, preferring parents whose kids are in each match
  const distributeEventDutiesToMatches = useCallback(async (matchIds: string[], matchPlayerIds: string[][]) => {
    // Fetch event-level duties
    const { data: eventDuties } = await supabase
      .from("duties")
      .select("id, name, assigned_to")
      .eq("event_id", eventId);
    
    if (!eventDuties || eventDuties.length === 0) return;

    // Build a map: player_id -> parent_user_id
    const playerParentMap = new Map<string, string>();
    if (allPlayers) {
      for (const p of allPlayers) {
        if (p.parent_user_id) playerParentMap.set(p.id, p.parent_user_id);
      }
    }

    // For each match, find which parents have kids playing
    const matchParentIds: string[][] = matchPlayerIds.map(playerIds => {
      const parents = new Set<string>();
      for (const pid of playerIds) {
        const parentId = playerParentMap.get(pid);
        if (parentId) parents.add(parentId);
      }
      return [...parents];
    });

    // Track how many duties each parent has been assigned (for fair rotation)
    const parentDutyCount = new Map<string, number>();

    // For each duty, create an event_group_duty in every match
    const dutyInserts: { group_id: string; name: string; assigned_to: string | null; status: string }[] = [];

    for (const duty of eventDuties) {
      for (let matchIdx = 0; matchIdx < matchIds.length; matchIdx++) {
        let assignedTo: string | null = null;

        if (duty.assigned_to) {
          // If the event-level duty is pre-assigned, check if that parent has a kid in this match
          const parentInMatch = matchParentIds[matchIdx].includes(duty.assigned_to);
          if (parentInMatch) {
            assignedTo = duty.assigned_to;
          }
        }

        // If not pre-assigned or parent not in this match, pick the least-burdened parent from this match
        if (!assignedTo && matchParentIds[matchIdx].length > 0) {
          const candidates = matchParentIds[matchIdx]
            .map(pid => ({ id: pid, count: parentDutyCount.get(pid) || 0 }))
            .sort((a, b) => a.count - b.count);
          assignedTo = candidates[0].id;
        }

        if (assignedTo) {
          parentDutyCount.set(assignedTo, (parentDutyCount.get(assignedTo) || 0) + 1);
        }

        dutyInserts.push({
          group_id: matchIds[matchIdx],
          name: duty.name,
          assigned_to: assignedTo,
          status: assignedTo ? "confirmed" : "pending",
        });
      }
    }

    if (dutyInserts.length > 0) {
      await supabase.from("event_group_duties").insert(dutyInserts);
    }
  }, [eventId, allPlayers]);

  // Auto-generate matches (core logic)
  const runAutoGenerate = useCallback(async (abilityModeOverride?: "similar" | "mixed") => {
    const effectiveAbilityMode = abilityModeOverride || abilityMode;
    if (!availablePlayers || availablePlayers.length === 0) {
      throw new Error("No available players for this session");
    }

    const minPlayersPerSide = miniLeague?.min_players_per_side || 2;
    const minPlayersPerMatch = minPlayersPerSide * 2;

    if (availablePlayers.length < minPlayersPerMatch) {
      throw new Error(`Need at least ${minPlayersPerMatch} players (${minPlayersPerSide}v${minPlayersPerSide}) to create a match`);
    }

    const effectivePlayersPerTeam = showAdvanced ? playersPerTeam : (miniLeague?.team_size || 6);
    const playersPerMatch = effectivePlayersPerTeam * 2;
    
    const maxMatchesForMinPlayers = Math.floor(availablePlayers.length / minPlayersPerMatch);
    let effectiveNumMatches = showAdvanced 
      ? numGroups
      : Math.ceil(availablePlayers.length / playersPerMatch);
    
    effectiveNumMatches = Math.min(effectiveNumMatches, maxMatchesForMinPlayers);

    if (effectiveNumMatches < 1) {
      throw new Error(`Need at least ${minPlayersPerMatch} players (${minPlayersPerSide}v${minPlayersPerSide}) to create a match`);
    }

    const sortedPlayers = [...availablePlayers];
    const leagueColors = miniLeague?.bib_colors || DEFAULT_BIB_COLORS;
    const matchNames = ["Match 1", "Match 2", "Match 3", "Match 4", "Match 5", "Match 6", "Match 7", "Match 8"];

    // Build the match metadata first; nothing is written until the single
    // atomic `replace_event_groups` RPC below, so a mid-way failure can never
    // leave half-created matches behind.
    const matchSpecs = Array.from({ length: effectiveNumMatches }, (_, i) => {
      const colors = getMatchColors(i, leagueColors);
      const abilityBand = effectiveAbilityMode === "similar"
        ? (["Advanced", "Intermediate", "Beginner"][Math.floor(i / Math.ceil(effectiveNumMatches / 3))] || null)
        : null;
      return {
        name: matchNames[i] || `Match ${i + 1}`,
        ability_band: abilityBand,
        pitch_name: `Pitch ${i + 1}`,
        display_order: i + 1,
        team_a_color: colors.teamA,
        team_b_color: colors.teamB,
      };
    });


    // Calculate target sizes
    const totalPlayerCount = sortedPlayers.length;
    const matchTargetSizes: number[] = [];
    let remaining = totalPlayerCount;
    
    for (let i = 0; i < effectiveNumMatches; i++) {
      const matchesLeft = effectiveNumMatches - i;
      const avgRemaining = remaining / matchesLeft;
      let target = Math.min(playersPerMatch, Math.floor(avgRemaining));
      if (target % 2 !== 0) target = target - 1;
      if (target < minPlayersPerMatch && remaining >= minPlayersPerMatch) target = minPlayersPerMatch;
      if (i === effectiveNumMatches - 1) target = remaining;
      matchTargetSizes.push(target);
      remaining -= target;
    }
    
    // Distribute players
    const matchPlayers: { playerId: string; team: "a" | "b" }[][] = Array(effectiveNumMatches).fill(null).map(() => []);
    
    if (effectiveAbilityMode === "similar") {
      let playerIdx = 0;
      for (let matchIdx = 0; matchIdx < effectiveNumMatches && playerIdx < sortedPlayers.length; matchIdx++) {
        const targetSize = matchTargetSizes[matchIdx];
        for (let j = 0; j < targetSize && playerIdx < sortedPlayers.length; j++) {
          matchPlayers[matchIdx].push({ playerId: sortedPlayers[playerIdx].id, team: "a" });
          playerIdx++;
        }
      }
    } else {
      let forward = true;
      let matchIndex = 0;
      
      sortedPlayers.forEach((player) => {
        let attempts = 0;
        while (matchPlayers[matchIndex].length >= matchTargetSizes[matchIndex] && attempts < effectiveNumMatches * 2) {
          if (forward) {
            matchIndex++;
            if (matchIndex >= effectiveNumMatches) { matchIndex = effectiveNumMatches - 1; forward = false; }
          } else {
            matchIndex--;
            if (matchIndex < 0) { matchIndex = 0; forward = true; }
          }
          attempts++;
        }
        
        if (matchPlayers[matchIndex].length < matchTargetSizes[matchIndex]) {
          matchPlayers[matchIndex].push({ playerId: player.id, team: "a" });
        } else {
          for (let i = 0; i < effectiveNumMatches; i++) {
            if (matchPlayers[i].length < matchTargetSizes[i]) {
              matchPlayers[i].push({ playerId: player.id, team: "a" });
              break;
            }
          }
        }
        
        if (forward) {
          matchIndex++;
          if (matchIndex >= effectiveNumMatches) { matchIndex = effectiveNumMatches - 1; forward = false; }
        } else {
          matchIndex--;
          if (matchIndex < 0) { matchIndex = 0; forward = true; }
        }
      });
    }
    
    // Balance teams within each match
    matchPlayers.forEach((players) => {
      const teamASize = Math.floor(players.length / 2);
      players.forEach((p, idx) => { p.team = idx < teamASize ? "a" : "b"; });
    });

    // Single atomic write: matches + player assignments commit together.
    const { data: createdIds, error: replaceError } = await supabase.rpc("replace_event_groups", {
      p_event_id: eventId,
      p_groups: matchSpecs.map((spec, i) => ({
        ...spec,
        players: matchPlayers[i].map(p => ({ player_id: p.playerId, team: p.team })),
      })),
      p_delete_existing: false,
    });
    if (replaceError) throw replaceError;

    const matchIds = (createdIds as string[] | null) ?? [];

    // Auto-distribute event-level duties to matches
    await distributeEventDutiesToMatches(matchIds, matchPlayers.map(mp => mp.map(p => p.playerId)));

    return { numCreated: effectiveNumMatches, matchIds, matchPlayerIds: matchPlayers.map(mp => mp.map(p => p.playerId)) };

  }, [availablePlayers, miniLeague, showAdvanced, playersPerTeam, numGroups, abilityMode, eventId]);

  // Create group mutation - with player assignments
  const createGroupMutation = useMutation({
    mutationFn: async (data: { name: string; pitchName: string; teamAPlayerIds: string[]; teamBPlayerIds: string[] }) => {
      const leagueColors = miniLeague?.bib_colors || DEFAULT_BIB_COLORS;
      const colors = getMatchColors(groups?.length || 0, leagueColors);
      const { data: newGroup, error } = await supabase.from("event_groups").insert({
        event_id: eventId,
        name: data.name,
        pitch_name: data.pitchName || null,
        display_order: (groups?.length || 0) + 1,
        team_a_color: colors.teamA,
        team_b_color: colors.teamB,
      }).select().single();
      if (error) throw error;

      // Insert player assignments
      // event_id is re-derived server-side from the group; sent only to satisfy the NOT NULL column.
      const playerInserts = [
        ...data.teamAPlayerIds.map(pid => ({ event_id: eventId, group_id: newGroup.id, player_id: pid, team: "a" as const })),
        ...data.teamBPlayerIds.map(pid => ({ event_id: eventId, group_id: newGroup.id, player_id: pid, team: "b" as const })),
      ];
      if (playerInserts.length > 0) {
        const { error: playerError } = await supabase.from("event_group_players").insert(playerInserts);
        if (playerError) throw playerError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
      setIsCreateOpen(false);
      toast.success("Match created");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Auto-generate mutation
  const autoGenMutation = useMutation({
    mutationFn: () => runAutoGenerate(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
      queryClient.invalidateQueries({ queryKey: ["event-all-group-duties", eventId] });
      setIsAutoGenOpen(false);
      toast.success(`${result.numCreated} matches created with balanced teams & duties assigned`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Quick setup - opens dialog for duty assignment, then generates matches
  const quickSetupMutation = useMutation({
    mutationFn: async ({ assignments: dutyAssignments, abilityMode: mode }: { assignments: Record<string, string[]>; abilityMode: "similar" | "mixed" }) => {
      await refetchRsvps();
      const result = await runAutoGenerate(mode);

      // Create Referee and Oranges match duties for each match
      const QUICK_SETUP_DUTIES = ["Referee", "Oranges"];

      // Build parent map for smart assignment
      const playerParentMap = new Map<string, string>();
      if (allPlayers) {
        for (const p of allPlayers) {
          if (p.parent_user_id) playerParentMap.set(p.id, p.parent_user_id);
        }
      }

      // For each match, find which parents have kids playing
      const matchParentIds = result.matchPlayerIds.map(playerIds => {
        const parents = new Set<string>();
        for (const pid of playerIds) {
          const parentId = playerParentMap.get(pid);
          if (parentId) parents.add(parentId);
        }
        return [...parents];
      });

      const parentDutyCount = new Map<string, number>();
      const dutyInserts: { group_id: string; name: string; assigned_to: string | null; status: string }[] = [];

      for (const dutyName of QUICK_SETUP_DUTIES) {
        const selectedParents = dutyAssignments[dutyName] || [];

        for (let matchIdx = 0; matchIdx < result.matchIds.length; matchIdx++) {
          if (selectedParents.length > 0) {
            // Create one duty row per selected parent
            for (const parentId of selectedParents) {
              dutyInserts.push({
                group_id: result.matchIds[matchIdx],
                name: dutyName,
                assigned_to: parentId,
                status: "confirmed",
              });
            }
          } else {
            // No one selected — create unassigned duty
            dutyInserts.push({
              group_id: result.matchIds[matchIdx],
              name: dutyName,
              assigned_to: null,
              status: "pending",
            });
          }
        }
      }

      if (dutyInserts.length > 0) {
        await supabase.from("event_group_duties").insert(dutyInserts);
      }

      return result.numCreated;
    },
    onSuccess: (numCreated) => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
      queryClient.invalidateQueries({ queryKey: ["event-all-group-duties", eventId] });
      setIsQuickSetupOpen(false);
      toast.success(`${numCreated} matches created with Referee & Oranges assigned`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Copy from previous mutation
  const copyFromPreviousMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPreviousEventId) throw new Error("Select an event");

      // Get players who have RSVP'd "going" to the CURRENT session
      const { data: currentRsvps } = await supabase
        .from("rsvps")
        .select("mini_league_player_id")
        .eq("event_id", eventId)
        .eq("status", "going");
      
      const goingPlayerIds = new Set(
        (currentRsvps || [])
          .map(r => r.mini_league_player_id)
          .filter(Boolean) as string[]
      );

      const { data: prevGroups, error: groupsError } = await supabase
        .from("event_groups")
        .select("*")
        .eq("event_id", selectedPreviousEventId)
        .order("display_order");
      if (groupsError) throw groupsError;

      const newMatchPlayerIds: string[][] = [];
      const groupPayload: Json[] = [];
      let skippedCount = 0;

      for (const prevGroup of prevGroups || []) {
        const { data: prevPlayers, error: prevPlayersError } = await supabase
          .from("event_group_players")
          .select("player_id, team")
          .eq("group_id", prevGroup.id);
        if (prevPlayersError) throw prevPlayersError;

        const playerIds: string[] = [];
        let players: { player_id: string; team: string | null }[] = [];

        if (prevPlayers && prevPlayers.length > 0) {
          // Only include players who RSVP'd going to the current session
          const eligiblePlayers = goingPlayerIds.size > 0
            ? prevPlayers.filter(p => goingPlayerIds.has(p.player_id))
            : prevPlayers; // If no RSVPs exist at all, copy all (fallback)

          skippedCount += prevPlayers.length - eligiblePlayers.length;

          players = eligiblePlayers.map(p => ({ player_id: p.player_id, team: p.team }));
          playerIds.push(...eligiblePlayers.map(p => p.player_id));
        }

        groupPayload.push({
          name: prevGroup.name,
          ability_band: prevGroup.ability_band,
          pitch_name: prevGroup.pitch_name,
          display_order: prevGroup.display_order,
          team_a_color: prevGroup.team_a_color || "#ef4444",
          team_b_color: prevGroup.team_b_color || "#3b82f6",
          players,
        } as unknown as Json);
        newMatchPlayerIds.push(playerIds);
      }

      // Single atomic write: every copied match + its players, or nothing.
      const { data: createdIds, error: replaceError } = await supabase.rpc("replace_event_groups", {
        p_event_id: eventId,
        p_groups: groupPayload as Json,
        p_delete_existing: false,
      });
      if (replaceError) throw replaceError;

      const newMatchIds = (createdIds as string[] | null) ?? [];

      // Auto-distribute event-level duties to copied matches
      await distributeEventDutiesToMatches(newMatchIds, newMatchPlayerIds);

      return { skippedCount };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
      queryClient.invalidateQueries({ queryKey: ["event-all-group-duties", eventId] });
      setIsCopyPreviousOpen(false);
      setSelectedPreviousEventId(null);
      const msg = result?.skippedCount 
        ? `Matches copied (${result.skippedCount} player${result.skippedCount === 1 ? '' : 's'} skipped - not RSVP'd going)`
        : "Matches copied with duties assigned";
      toast.success(msg);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Delete group mutation
  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase.from("event_groups").delete().eq("id", groupId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
      toast.success("Group deleted");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Delete all groups mutation
  const deleteAllGroupsMutation = useMutation({
    mutationFn: async () => {
      const groupIds = groups?.map(g => g.id) || [];
      for (const groupId of groupIds) {
        const { error } = await supabase.from("event_groups").delete().eq("id", groupId);
        // Stop at the first failure — never continue deleting or report success.
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Move player mutation (move to a team)
  const movePlayerMutation = useMutation({
    mutationFn: async ({ playerId, fromGroupId, toGroupId, toTeam }: { playerId: string; fromGroupId: string; toGroupId: string; toTeam: "a" | "b" }) => {
      if (fromGroupId === toGroupId) {
        const { error } = await supabase
          .from("event_group_players")
          .update({ team: toTeam })
          .eq("group_id", fromGroupId)
          .eq("player_id", playerId);
        if (error) throw error;
      } else {
        // True in-place move (single UPDATE) — no delete/insert window in
        // which the player could be dropped from every group.
        const { error } = await supabase.rpc("move_event_group_player", {
          p_player_id: playerId,
          p_from_group_id: fromGroupId,
          p_to_group_id: toGroupId,
          p_to_team: toTeam,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
      setSwapSource(null);
      toast.success("Player moved");
    },
    onError: (error: Error) => {
      toast.error(error.message);
      setSwapSource(null);
    },
  });

  // Swap two players between teams
  const swapPlayersMutation = useMutation({
    mutationFn: async ({ 
      player1Id, player1GroupId, player1Team, 
      player2Id, player2GroupId, player2Team 
    }: { 
      player1Id: string; player1GroupId: string; player1Team: "a" | "b"; 
      player2Id: string; player2GroupId: string; player2Team: "a" | "b";
    }) => {
      // Single atomic RPC: all writes commit together or none do, so a
      // failure part-way can never leave a player removed but not re-added.
      const { error } = await supabase.rpc("swap_event_group_players", {
        p_player1_id: player1Id,
        p_player1_group_id: player1GroupId,
        p_player1_team: player1Team,
        p_player2_id: player2Id,
        p_player2_group_id: player2GroupId,
        p_player2_team: player2Team,
      });
      if (error) throw error;

    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-groups", eventId] });
      setSwapSource(null);
      toast.success("Players swapped");
    },
    onError: (error: Error) => {
      toast.error(error.message);
      setSwapSource(null);
    },
  });

  // Regenerate handler
  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      await refetchRsvps();
      await deleteAllGroupsMutation.mutateAsync();
      setIsAutoGenOpen(true);
    } catch (error) {
      // Error handled by mutation
    } finally {
      setIsRegenerating(false);
    }
  };

  // Resolve selected player name for UI hints
  const swapSourcePlayerName = swapSource
    ? groups?.flatMap(g => g.players).find(p => p.id === swapSource.playerId)?.name || "Selected player"
    : null;

  // Handle player tap for swap mode
  const handlePlayerTap = (groupId: string, playerId: string, currentTeam: "a" | "b" | null) => {
    if (!isAdmin) return;
    
    if (!swapSource) {
      // Select source player
      setSwapSource({ groupId, playerId, team: currentTeam });
    } else if (swapSource.playerId === playerId && swapSource.groupId === groupId) {
      // Deselect
      setSwapSource(null);
    } else if (currentTeam && swapSource.team) {
      // Tapped a second player — swap them between teams
      swapPlayersMutation.mutate({
        player1Id: swapSource.playerId,
        player1GroupId: swapSource.groupId,
        player1Team: swapSource.team,
        player2Id: playerId,
        player2GroupId: groupId,
        player2Team: currentTeam,
      });
    } else if (currentTeam) {
      // Fallback: move source to this team
      handleTeamTap(groupId, currentTeam);
    } else {
      setSwapSource(null);
    }
  };

  // Handle team header tap as destination
  const handleTeamTap = (groupId: string, team: "a" | "b") => {
    if (!isAdmin || !swapSource) return;
    
    // Move source player to this team
    movePlayerMutation.mutate({
      playerId: swapSource.playerId,
      fromGroupId: swapSource.groupId,
      toGroupId: groupId,
      toTeam: team,
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Members only see matches when the league admin has opted in. Default is OFF.
  if (!isAdmin && !miniLeague?.show_matches_to_members) {
    return null;
  }

  const hasGroups = groups && groups.length > 0;

  // Calculate unallocated players (available but not in any match)
  const allocatedPlayerIds = new Set(
    groups?.flatMap(g => g.players.map(p => p.id)) || []
  );
  const unallocatedPlayers = availablePlayers.filter(p => !allocatedPlayerIds.has(p.id));
  const hasUnallocatedPlayers = unallocatedPlayers.length > 0;

  // Determine round progression status
  const roundStatus = (() => {
    if (!hasGroups) {
      return { label: "Round not set up", color: "bg-muted text-muted-foreground" };
    }
    // Check if any group has a timer state indicating in-progress
    const hasTimerRunning = groups?.some(g => {
      const ts = g as any;
      return ts.timer_state && typeof ts.timer_state === 'object';
    });
    if (hasTimerRunning) {
      return { label: "Games in progress", color: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30" };
    }
    return { label: "Matches generated", color: "bg-primary/15 text-primary border-primary/30" };
  })();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Matches</h3>
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 ${roundStatus.color}`}>
            {roundStatus.label}
          </Badge>
        </div>
        {isAdmin && hasGroups && (
          <div className="flex gap-2">
            {/* Swap mode indicator */}
            {swapSource && (
              <Button size="sm" variant="destructive" onClick={() => setSwapSource(null)}>
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="px-2">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleRegenerate} disabled={isRegenerating}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Regenerate All
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => setIsCreateOpen(true)}
                  disabled={!hasUnallocatedPlayers}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Match Manually
                  {!hasUnallocatedPlayers && (
                    <span className="ml-1 text-xs text-muted-foreground">(no players left)</span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsCopyPreviousOpen(true)}>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy from Previous
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {hasGroups ? (
        <div className="space-y-3">
          {isAdmin && !swapSource && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ArrowRightLeft className="h-3 w-3" />
              Tap a player, then tap another to swap them · Or tap a team header to move
            </p>
          )}
          {isAdmin && swapSource && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-primary/10 border border-primary/20 text-sm">
              <ArrowRightLeft className="h-4 w-4 text-primary shrink-0" />
              <span>
                <span className="font-semibold text-primary">{swapSourcePlayerName}</span>
                {" selected — tap another player to "}
                <span className="font-semibold">swap</span>
                {" or tap a team header to "}
                <span className="font-semibold">move</span>
              </span>
            </div>
          )}
          <div className="grid gap-3">
            {groups.map((group) => (
              <EventGroupCard
                key={group.id}
                group={group}
                isAdmin={isAdmin}
                swapSource={swapSource}
                duties={(allGroupDuties?.[group.id] || []) as EventGroupDuty[]}
                boardSupported={boardSupported}
                onDeleteGroup={(groupId) => deleteGroupMutation.mutate(groupId)}
                onPlayerTap={handlePlayerTap}
                onTeamTap={handleTeamTap}
                onQuickAssignDuty={(dutyId, selectedGroup) => {
                  setQuickAssignDutyId(dutyId);
                  setActiveDutiesGroup(selectedGroup);
                }}
                onOpenPitchBoard={setActivePitchBoardGroup}
              />
            ))}
          </div>
        </div>
      ) : isAdmin ? (
        /* Empty State - Generate Matches (admins only) */
        <Card className="border-dashed">
          <CardContent className="py-8 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Shirt className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h4 className="font-semibold text-base">Generate this round's games</h4>
              <p className="text-sm text-muted-foreground mt-1">
                {availablePlayers.length > 0 
                  ? `${availablePlayers.length} player${availablePlayers.length === 1 ? '' : 's'} ready — generate matches`
                  : "Select players as attending first to generate matches"}
              </p>
            </div>
            <div className="space-y-2 pt-1">
              <Button 
                className="w-full h-12 text-base font-semibold"
                onClick={() => setIsQuickSetupOpen(true)}
                disabled={quickSetupMutation.isPending || availablePlayers.length === 0}
              >
                {quickSetupMutation.isPending ? (
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                ) : (
                  <Wand2 className="h-5 w-5 mr-2" />
                )}
                Generate Matches
              </Button>
              <p className="text-[11px] text-muted-foreground/60">
                Automatically create balanced games based on who is playing
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Manual Match Dialog */}
      <ManualMatchDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onConfirm={(data) => createGroupMutation.mutate(data)}
        isPending={createGroupMutation.isPending}
        availablePlayers={unallocatedPlayers}
        existingMatchCount={groups?.length || 0}
      />

      <ResponsiveDialog open={isAutoGenOpen} onOpenChange={setIsAutoGenOpen}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Generate Matches</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Create balanced matches from {availablePlayers.length} available players
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="py-2 space-y-4 px-1">
            {/* Ability Assignment Mode */}
            <div className="space-y-2">
              <Label>Ability Grouping</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={abilityMode === "similar" ? "default" : "outline"}
                  size="sm"
                  className="flex flex-col h-auto py-3"
                  onClick={() => setAbilityMode("similar")}
                >
                  <span className="font-medium">Similar</span>
                  <span className="text-xs opacity-70 font-normal mt-0.5">
                    Same levels together
                  </span>
                </Button>
                <Button
                  variant={abilityMode === "mixed" ? "default" : "outline"}
                  size="sm"
                  className="flex flex-col h-auto py-3"
                  onClick={() => setAbilityMode("mixed")}
                >
                  <span className="font-medium">Mixed</span>
                  <span className="text-xs opacity-70 font-normal mt-0.5">
                    Balanced across matches
                  </span>
                </Button>
              </div>
            </div>

            {/* Summary */}
            <div className="p-3 rounded-lg border bg-muted/30">
              {(() => {
                const teamSize = showAdvanced ? playersPerTeam : (miniLeague?.team_size || 4);
                const minPerSide = miniLeague?.min_players_per_side || 3;
                const ppm = teamSize * 2;
                const minPPM = minPerSide * 2;
                const idealMatches = showAdvanced ? numGroups : Math.ceil(availablePlayers.length / ppm);
                const maxForMin = Math.floor(availablePlayers.length / minPPM);
                const actual = Math.min(idealMatches, maxForMin);
                
                return (
                  <div className="space-y-1">
                    <p className="text-sm">
                      <span className="font-bold text-primary">{availablePlayers.length}</span> players →{" "}
                      <span className="font-bold">{actual}</span>{" "}
                      {actual === 1 ? "match" : "matches"} ({teamSize}v{teamSize})
                    </p>
                    {availablePlayers.length === 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        No players available. Use the Responses section to manage attendance.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Advanced Options - Collapsible */}
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground">
                  Advanced Options
                  <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Players per Side</Label>
                  <div className="flex gap-2 flex-wrap">
                    {[4, 5, 6, 7, 8].map((n) => (
                      <Button
                        key={n}
                        variant={playersPerTeam === n ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPlayersPerTeam(n)}
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Number of Matches</Label>
                  <div className="flex gap-2 flex-wrap">
                    {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <Button
                        key={n}
                        variant={numGroups === n ? "default" : "outline"}
                        size="sm"
                        onClick={() => setNumGroups(n)}
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          <ResponsiveDialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              onClick={() => autoGenMutation.mutate()}
              disabled={autoGenMutation.isPending || availablePlayers.length === 0}
              className="w-full sm:w-auto h-12 text-base"
            >
              {autoGenMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generate
            </Button>
            <Button variant="outline" onClick={() => setIsAutoGenOpen(false)} className="w-full sm:w-auto h-12 text-base">
              Cancel
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Copy from Previous Dialog */}
      <Dialog open={isCopyPreviousOpen} onOpenChange={setIsCopyPreviousOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy from Previous</DialogTitle>
            <DialogDescription>
              Copy match assignments from a previous session
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2 max-h-60 overflow-y-auto">
            {previousEvents?.map((event) => (
              <div
                key={event.id}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedPreviousEventId === event.id
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/50"
                }`}
                onClick={() => setSelectedPreviousEventId(event.id)}
              >
                <Checkbox checked={selectedPreviousEventId === event.id} />
                <div>
                  <p className="font-medium text-sm">{event.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(event.event_date).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
            {(!previousEvents || previousEvents.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No previous events found
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCopyPreviousOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => copyFromPreviousMutation.mutate()}
              disabled={!selectedPreviousEventId || copyFromPreviousMutation.isPending}
            >
              {copyFromPreviousMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Copy Matches
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Match Duties Dialog */}
      <Suspense fallback={null}>
      <MatchDutiesDialog
        open={!!activeDutiesGroup}
        onOpenChange={(open) => {
          if (!open) {
            setActiveDutiesGroup(null);
            setQuickAssignDutyId(null);
            // Refresh inline badges
            queryClient.invalidateQueries({ queryKey: ["event-all-group-duties", eventId] });
          }
        }}
        groupId={activeDutiesGroup?.id || ""}
        groupName={activeDutiesGroup?.name || ""}
        miniLeagueId={miniLeagueId}
        initialDutyId={quickAssignDutyId}
      />
      </Suspense>

      {/* Pitch Board Portal */}
      {boardSupported && activePitchBoardGroup && activePitchBoardGroup.players.length > 0 && createPortal(
        <Suspense fallback={
          <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ backgroundColor: '#2d5a27' }}>
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-primary">
                  <Flame className="h-8 w-8 text-primary-foreground" />
                </div>
                <span className="text-4xl" role="img" aria-label="soccer ball">⚽</span>
              </div>
              <Loader2 className="h-6 w-6 animate-spin text-white" />
              <p className="text-sm text-white/80">Loading Pitch Board...</p>
            </div>
          </div>
        }>
          <PitchBoard
            key={activePitchBoardGroup.id}
            teamId={`event-group-${activePitchBoardGroup.id}`}
            teamName={activePitchBoardGroup.name}
            members={activePitchBoardGroup.players.map((player, index) => ({
              id: `player-${index}`,
              user_id: player.id,
              role: "player",
              profiles: {
                display_name: player.name,
                avatar_url: null,
              },
            }))}
            onClose={() => setActivePitchBoardGroup(null)}
            disableAutoSubs={false}
            initialRotationSpeed={2}
            initialDisablePositionSwaps={false}
            initialDisableBatchSubs={false}
            initialMinutesPerHalf={miniLeague?.minutes_per_half || 10}
            initialTeamSize={(() => {
              const teamACount = activePitchBoardGroup.players.filter(p => p.team === "a").length;
              const teamBCount = activePitchBoardGroup.players.filter(p => p.team === "b").length;
              const avgTeamSize = Math.max(Math.ceil((teamACount + teamBCount) / 2), 3);
              if (avgTeamSize <= 3) return 3;
              if (avgTeamSize <= 4) return 4;
              if (avgTeamSize <= 5) return 5;
              if (avgTeamSize <= 6) return 6;
              if (avgTeamSize <= 7) return 7;
              if (avgTeamSize <= 8) return 8;
              if (avgTeamSize <= 9) return 9;
              if (avgTeamSize <= 10) return 10;
              return 11;
            })()}
            readOnly={false}
            initialLinkedEventId={null}
            initialShowMatchHeader={false}
            miniLeagueTeams={{
              teamAPlayerIds: activePitchBoardGroup.players.filter(p => p.team === "a").map(p => p.id),
              teamBPlayerIds: activePitchBoardGroup.players.filter(p => p.team === "b").map(p => p.id),
              teamAColor: activePitchBoardGroup.team_a_color || "#ef4444",
              teamBColor: activePitchBoardGroup.team_b_color || "#3b82f6",
              teamAName: "Team A",
              teamBName: "Team B",
            }}
          />
        </Suspense>,
        document.body
      )}
      {/* Quick Setup Duty Dialog */}
      <QuickSetupDutyDialog
        open={isQuickSetupOpen}
        onOpenChange={setIsQuickSetupOpen}
        onConfirm={(data) => quickSetupMutation.mutate(data)}
        isPending={quickSetupMutation.isPending}
        parents={parentProfiles || []}
        playerCount={availablePlayers.length}
      />
    </div>
  );
}
