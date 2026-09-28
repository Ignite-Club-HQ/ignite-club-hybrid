import { useState, useRef, useCallback, Suspense } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Trash2, Loader2, Star, CheckSquare, Pencil, Check, X, UserRound, GripVertical, UserPlus, MoreVertical, Plus } from "lucide-react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
const AddSecondParentDialog = lazyWithRetry(() => import("@/components/mini-league/AddSecondParentDialog").then(m => ({ default: m.AddSecondParentDialog })));
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import PendingInvitesList from "@/components/PendingInvitesList";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  useDroppable,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

export interface MiniLeaguePlayer {
  id: string;
  name: string;
  ability_rating: number;
  notes: string | null;
  parent_user_id: string | null;
  child_id: string | null;
}

interface ParentProfile {
  id: string;
  display_name: string | null;
}

interface ManagePlayersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  miniLeagueId: string;
  miniLeagueName: string;
  clubId: string;
  canManage: boolean;
  onOpenAddPlayers?: () => void;
}

const getAbilityLabel = (rating: number) => {
  const labels = ["Unrated", "Beginner", "Developing", "Intermediate", "Advanced", "Expert"];
  return labels[rating] || "";
};

const getAbilityColor = (rating: number) => {
  const colors: Record<number, string> = {
    0: "bg-muted text-muted-foreground",
    1: "bg-destructive/20 text-destructive",
    2: "bg-orange-500/20 text-orange-600 dark:text-orange-400",
    3: "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400",
    4: "bg-green-500/20 text-green-600 dark:text-green-400",
    5: "bg-primary/20 text-primary",
  };
  return colors[rating] || "";
};

// Droppable group zone
function DroppableGroup({ rating, children, isOver }: { rating: number; children: React.ReactNode; isOver?: boolean }) {
  const { setNodeRef, isOver: dropIsOver } = useDroppable({
    id: `group-${rating}`,
    data: { rating },
  });

  const active = isOver || dropIsOver;

  return (
    <div
      ref={setNodeRef}
      className={`space-y-2 rounded-lg p-2 -mx-2 min-h-[48px] transition-colors ${active ? "bg-primary/10 ring-2 ring-primary/30" : ""}`}
    >
      {children}
    </div>
  );
}

// Draggable player card wrapper
function DraggablePlayerCard({ player, children, canDrag }: { player: MiniLeaguePlayer; children: React.ReactNode; canDrag: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: player.id,
    data: { player },
    disabled: !canDrag,
  });

  const style = transform ? {
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.4 : undefined,
  } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative flex items-center"
    >
      {canDrag && (
        <button
          type="button"
          className="w-6 shrink-0 flex items-center justify-center opacity-40 touch-none -ml-1"
          aria-label="Drag to reorder"
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
}

export function ManagePlayersDialog({
  open,
  onOpenChange,
  miniLeagueId,
  miniLeagueName,
  clubId,
  canManage,
  onOpenAddPlayers,
}: ManagePlayersDialogProps) {
  const queryClient = useQueryClient();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [playerSearch, setPlayerSearch] = useState("");
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const [activePlayer, setActivePlayer] = useState<MiniLeaguePlayer | null>(null);
  const [secondParentForPlayer, setSecondParentForPlayer] = useState<MiniLeaguePlayer | null>(null);
  const [openMenuPlayerId, setOpenMenuPlayerId] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [deleteConfirmPlayer, setDeleteConfirmPlayer] = useState<MiniLeaguePlayer | null>(null);

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 8 },
  });
  const sensors = useSensors(pointerSensor, touchSensor);

  // Fetch players
  const { data: players, isLoading: playersLoading } = useQuery({
    queryKey: ["mini-league-players", miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("*")
        .eq("mini_league_id", miniLeagueId)
        .order("ability_rating", { ascending: false });
      if (error) throw error;
      return data as MiniLeaguePlayer[];
    },
    enabled: !!miniLeagueId && open,
  });

  // Fetch parent profiles for linked players
  const parentUserIds = [...new Set((players || []).map(p => p.parent_user_id).filter(Boolean) as string[])];
  const { data: parentProfiles } = useQuery({
    queryKey: ["parent-profiles", parentUserIds],
    queryFn: async () => {
      if (parentUserIds.length === 0) return [];
      const { data, error } = await selectCachedProfilesByIds(parentUserIds);
      if (error) throw error;
      return data as ParentProfile[];
    },
    enabled: parentUserIds.length > 0 && open,
  });

  const parentMap = new Map((parentProfiles || []).map(p => [p.id, p.display_name || "Unknown"]));

  // Fetch additional guardians (second parents) for all children in the list
  const childIdsForGuardians = [...new Set((players || []).map(p => p.child_id).filter(Boolean) as string[])];
  const { data: additionalGuardians } = useQuery({
    queryKey: ["mini-league-additional-guardians", miniLeagueId, childIdsForGuardians],
    queryFn: async () => {
      if (childIdsForGuardians.length === 0) return [] as { child_id: string; guardian_id: string; display_name: string | null }[];
      const { data: gRows } = await supabase
        .from("child_guardians")
        .select("child_id, guardian_id")
        .in("child_id", childIdsForGuardians);
      const guardianIds = [...new Set((gRows || []).map(g => g.guardian_id))];
      if (guardianIds.length === 0) return [];
      const { data: profs } = await selectCachedProfilesByIds(guardianIds);
      const nameMap = new Map((profs || []).map(p => [p.id, p.display_name]));
      return (gRows || []).map(g => ({
        child_id: g.child_id,
        guardian_id: g.guardian_id,
        display_name: nameMap.get(g.guardian_id) ?? null,
      }));
    },
    enabled: open && childIdsForGuardians.length > 0,
  });

  const guardiansByChild = new Map<string, { guardian_id: string; display_name: string | null }[]>();
  (additionalGuardians || []).forEach(g => {
    const arr = guardiansByChild.get(g.child_id) || [];
    arr.push({ guardian_id: g.guardian_id, display_name: g.display_name });
    guardiansByChild.set(g.child_id, arr);
  });

  // Determine which players are "pending" (no parent has accepted the app yet).
  // A player is pending when: no parent_user_id on the player, no parent_id on the
  // linked child, and no entries in child_guardians for that child.
  const childIdsForPending = [...new Set((players || []).map(p => p.child_id).filter(Boolean) as string[])];
  const { data: pendingMeta } = useQuery({
    queryKey: ["mini-league-players-pending-meta", miniLeagueId, childIdsForPending],
    queryFn: async () => {
      if (childIdsForPending.length === 0) return { childParent: new Map<string, string | null>(), guardianCount: new Map<string, number>() };
      const [{ data: childRows }, { data: guardianRows }] = await Promise.all([
        supabase.from("children").select("id, parent_id").in("id", childIdsForPending),
        supabase.from("child_guardians").select("child_id").in("child_id", childIdsForPending),
      ]);
      const childParent = new Map<string, string | null>((childRows || []).map(c => [c.id, c.parent_id]));
      const guardianCount = new Map<string, number>();
      (guardianRows || []).forEach(g => guardianCount.set(g.child_id, (guardianCount.get(g.child_id) || 0) + 1));
      return { childParent, guardianCount };
    },
    enabled: open && childIdsForPending.length > 0,
  });

  const isPlayerPending = (player: MiniLeaguePlayer) => {
    if (player.parent_user_id) return false;
    if (!player.child_id) return true;
    const childParent = pendingMeta?.childParent.get(player.child_id) ?? null;
    const guardianCount = pendingMeta?.guardianCount.get(player.child_id) ?? 0;
    return !childParent && guardianCount === 0;
  };

  // Fetch pending invites
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["pending-invites", null, clubId, miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, role, invited_user_id, invited_label, invited_email, created_at, status, metadata")
        .eq("club_id", clubId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const filtered = (data || []).filter((inv: any) => {
        const metadata = inv.metadata as any;
        return metadata?.mini_league_id === miniLeagueId;
      });
      return filtered.map((inv: any) => ({ ...inv, profiles: null }));
    },
    enabled: !!clubId && !!miniLeagueId && open,
  });

  // Delete player mutation
  const deletePlayerMutation = useMutation({
    mutationFn: async (playerId: string) => {
      const { data: player } = await supabase
        .from("mini_league_players")
        .select("child_id")
        .eq("id", playerId)
        .single();

      const { error } = await supabase.from("mini_league_players").delete().eq("id", playerId);
      if (error) throw error;

      if (player?.child_id) {
        await supabase
          .from("child_mini_league_assignments")
          .delete()
          .eq("child_id", player.child_id)
          .eq("mini_league_id", miniLeagueId);

        const [{ count: leagueCount }, { count: teamCount }] = await Promise.all([
          supabase.from("child_mini_league_assignments").select("id", { count: "exact", head: true }).eq("child_id", player.child_id),
          supabase.from("child_team_assignments").select("id", { count: "exact", head: true }).eq("child_id", player.child_id),
        ]);

        if ((leagueCount || 0) === 0 && (teamCount || 0) === 0) {
          await supabase.from("children").delete().eq("id", player.child_id);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
      toast.success("Player removed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Bulk delete players mutation
  const bulkDeletePlayersMutation = useMutation({
    mutationFn: async (playerIds: string[]) => {
      const { data: playersToDelete } = await supabase
        .from("mini_league_players")
        .select("id, child_id")
        .in("id", playerIds);

      const childIds = (playersToDelete || []).map(p => p.child_id).filter(Boolean) as string[];

      const { error } = await supabase.from("mini_league_players").delete().in("id", playerIds);
      if (error) throw error;

      if (childIds.length > 0) {
        await supabase
          .from("child_mini_league_assignments")
          .delete()
          .in("child_id", childIds)
          .eq("mini_league_id", miniLeagueId);

        for (const childId of childIds) {
          const [{ count: leagueCount }, { count: teamCount }] = await Promise.all([
            supabase.from("child_mini_league_assignments").select("id", { count: "exact", head: true }).eq("child_id", childId),
            supabase.from("child_team_assignments").select("id", { count: "exact", head: true }).eq("child_id", childId),
          ]);
          if ((leagueCount || 0) === 0 && (teamCount || 0) === 0) {
            await supabase.from("children").delete().eq("id", childId);
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
      setSelectedPlayerIds(new Set());
      setSelectionMode(false);
      setBulkDeleteOpen(false);
      toast.success("Players removed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Update ability rating mutation
  const updateAbilityMutation = useMutation({
    mutationFn: async ({ playerId, childId, newRating }: { playerId: string; childId: string | null; newRating: number }) => {
      // DB CHECK constraint requires ability_rating IS NULL or 1..5.
      // "Unrated" (group 0) maps to NULL.
      const dbValue = newRating >= 1 && newRating <= 5 ? newRating : null;
      const { error } = await supabase
        .from("mini_league_players")
        .update({ ability_rating: dbValue })
        .eq("id", playerId);
      if (error) throw error;

      if (childId) {
        await supabase
          .from("child_mini_league_assignments")
          .update({ ability_rating: dbValue })
          .eq("child_id", childId)
          .eq("mini_league_id", miniLeagueId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Update player name mutation
  const updateNameMutation = useMutation({
    mutationFn: async ({ playerId, childId, newName }: { playerId: string; childId: string | null; newName: string }) => {
      const { error } = await supabase
        .from("mini_league_players")
        .update({ name: newName })
        .eq("id", playerId);
      if (error) throw error;

      if (childId) {
        await supabase
          .from("children")
          .update({ name: newName })
          .eq("id", childId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
      setEditingPlayerId(null);
      toast.success("Name updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const startEditingName = (player: MiniLeaguePlayer) => {
    setEditingPlayerId(player.id);
    setEditingName(player.name);
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  const saveEditingName = (player: MiniLeaguePlayer) => {
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === player.name) {
      setEditingPlayerId(null);
      return;
    }
    updateNameMutation.mutate({ playerId: player.id, childId: player.child_id, newName: trimmed });
  };

  const togglePlayerSelection = (playerId: string) => {
    const newSet = new Set(selectedPlayerIds);
    if (newSet.has(playerId)) newSet.delete(playerId);
    else newSet.add(playerId);
    setSelectedPlayerIds(newSet);
  };

  const toggleSelectAll = () => {
    if (!players) return;
    if (selectedPlayerIds.size === players.length) setSelectedPlayerIds(new Set());
    else setSelectedPlayerIds(new Set(players.map(p => p.id)));
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedPlayerIds(new Set());
  };

  const handleAddPlayersClick = () => {
    onOpenChange(false);
    setTimeout(() => onOpenAddPlayers?.(), 200);
  };

  // DnD handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const player = event.active.data.current?.player as MiniLeaguePlayer;
    if (player) setActivePlayer(player);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActivePlayer(null);
    const { active, over } = event;
    if (!over) return;

    const player = active.data.current?.player as MiniLeaguePlayer;
    if (!player) return;

    // Determine target rating from the droppable group
    let targetRating: number | null = null;

    if (over.id.toString().startsWith("group-")) {
      targetRating = over.data.current?.rating as number;
    } else {
      // Dropped on another player card - find that player's group
      const targetPlayer = players?.find(p => p.id === over.id);
      if (targetPlayer) {
        targetRating = targetPlayer.ability_rating;
      }
    }

    if (targetRating != null && targetRating !== player.ability_rating) {
      updateAbilityMutation.mutate({
        playerId: player.id,
        childId: player.child_id,
        newRating: targetRating,
      });
      toast.success(`${player.name} moved to ${getAbilityLabel(targetRating)}`);
    }
  }, [players, updateAbilityMutation]);

  const filteredPlayers = players?.filter(p =>
    !playerSearch.trim() || p.name.toLowerCase().includes(playerSearch.trim().toLowerCase())
  ) || [];

  const playersByAbility = filteredPlayers.reduce((acc, player) => {
    // Treat null/0 ability as "unrated" (bucket 0) so players without a
    // rating still appear in the list instead of disappearing.
    const raw = player.ability_rating;
    const key = raw && raw >= 1 && raw <= 5 ? raw : 0;
    if (!acc[key]) acc[key] = [];
    acc[key].push(player);
    return acc;
  }, {} as Record<number, MiniLeaguePlayer[]>);

  const canDrag = canManage && !selectionMode && !editingPlayerId;

  const renderPlayerCard = (player: MiniLeaguePlayer, isDragOverlay = false) => {
    const parentName = player.parent_user_id ? parentMap.get(player.parent_user_id) : null;
    const extraGuardians = (player.child_id ? guardiansByChild.get(player.child_id) : []) || [];
    const extraGuardianNames = extraGuardians
      .filter(g => g.guardian_id !== player.parent_user_id)
      .map(g => g.display_name || "Parent");
    const allParentNames = [parentName, ...extraGuardianNames].filter(Boolean) as string[];
    const isEditing = editingPlayerId === player.id;

    return (
      <Card
        className={`rounded-xl border-border/60 ${selectionMode && selectedPlayerIds.has(player.id) ? "ring-2 ring-primary" : ""} ${isDragOverlay ? "shadow-lg ring-2 ring-primary" : ""}`}
        onClick={selectionMode ? () => togglePlayerSelection(player.id) : undefined}
      >
        <CardContent className="py-2 px-2.5">
          <div className="flex items-center gap-2">
            {/* Left: checkbox in selection mode */}
            {selectionMode && (
              <Checkbox
                checked={selectedPlayerIds.has(player.id)}
                onCheckedChange={() => togglePlayerSelection(player.id)}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0"
              />
            )}

            {/* Main content column */}
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <div className="flex items-center gap-1 py-1">
                  <Input
                    ref={editInputRef}
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditingName(player);
                      if (e.key === "Escape") setEditingPlayerId(null);
                    }}
                    className="h-7 text-sm py-0 px-1.5"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    type="button"
                    className="p-1 text-primary"
                    onClick={(e) => { e.stopPropagation(); saveEditingName(player); }}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="p-1 text-muted-foreground"
                    onClick={(e) => { e.stopPropagation(); setEditingPlayerId(null); }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  {/* Row 1: name + pending */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[15px] leading-tight font-semibold text-foreground truncate">
                      {player.name}
                    </span>
                    {isPlayerPending(player) && (
                      <span className="inline-flex items-center h-4 px-1.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 shrink-0">
                        Pending
                      </span>
                    )}
                  </div>

                  {/* Row 2: parent · stars (compact, inline) */}
                  <div className="flex items-center gap-2 mt-0.5 min-w-0">
                    {allParentNames.length > 0 && (
                      <span className="flex items-center gap-1 min-w-0 text-xs text-muted-foreground">
                        <UserRound className="h-3 w-3 shrink-0 opacity-60" />
                        <span className="truncate">{allParentNames.join(", ")}</span>
                      </span>
                    )}
                    <div className="flex items-center -mr-0.5 ml-auto shrink-0">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          disabled={!canManage || selectionMode}
                          className={`p-0 ${canManage && !selectionMode ? "cursor-pointer active:scale-110 transition-transform" : ""}`}
                          onClick={
                            canManage && !selectionMode
                              ? (e) => {
                                  e.stopPropagation();
                                  const newRating = i + 1;
                                  if (newRating !== player.ability_rating) {
                                    updateAbilityMutation.mutate({ playerId: player.id, childId: player.child_id, newRating });
                                  }
                                }
                              : undefined
                          }
                          aria-label={`Rate ${i + 1} star${i === 0 ? "" : "s"}`}
                        >
                          <Star
                            className={`h-3 w-3 ${i < player.ability_rating ? "fill-primary text-primary" : "text-muted-foreground/30"}`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Right: overflow menu (inline, no portal — works inside Vaul drawer) */}
            {!selectionMode && canManage && !isEditing && !isDragOverlay && (
              <div className="relative shrink-0" data-vaul-no-drag>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 -mr-1 text-muted-foreground"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuPlayerId(openMenuPlayerId === player.id ? null : player.id);
                  }}
                  data-vaul-no-drag
                  aria-label="Player actions"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
                {openMenuPlayerId === player.id && (
                  <>
                    <div
                      className="fixed inset-0 z-[100000]"
                      onPointerDown={(e) => { e.stopPropagation(); setOpenMenuPlayerId(null); }}
                    />
                    <div className="absolute right-0 top-9 z-[100001] w-48 rounded-md border border-border bg-popover p-1 shadow-md">
                      <button
                        type="button"
                        className="flex w-full items-center rounded-sm px-2 py-2 text-sm text-popover-foreground hover:bg-accent"
                        onClick={(e) => { e.stopPropagation(); setOpenMenuPlayerId(null); startEditingName(player); }}
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit name
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center rounded-sm px-2 py-2 text-sm text-popover-foreground hover:bg-accent"
                        onClick={(e) => { e.stopPropagation(); setOpenMenuPlayerId(null); setSecondParentForPlayer(player); }}
                      >
                        <UserPlus className="h-4 w-4 mr-2" />
                        Invite second parent
                      </button>
                      <div className="my-1 h-px bg-border" />
                      <button
                        type="button"
                        className="flex w-full items-center rounded-sm px-2 py-2 text-sm text-destructive hover:bg-accent"
                        onClick={(e) => { e.stopPropagation(); setOpenMenuPlayerId(null); setDeleteConfirmPlayer(player); }}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remove player
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };


  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => {
      if (!o) {
        setSelectionMode(false);
        setSelectedPlayerIds(new Set());
        setPlayerSearch("");
        setEditingPlayerId(null);
      }
      onOpenChange(o);
    }}>
      <ResponsiveDialogContent className="sm:max-w-lg" fullScreen>
        <ResponsiveDialogHeader className="pb-3">
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Manage Players
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-2 px-3 py-2 pb-24">
          {/* Toolbar row: search (full width) + actions */}
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search players..."
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
              className="h-9 text-sm flex-1"
            />
            {canManage && (
              selectionMode ? (
                <>
                  <Button variant="ghost" size="sm" className="h-9 shrink-0" onClick={exitSelectionMode}>Cancel</Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-9 shrink-0"
                    disabled={selectedPlayerIds.size === 0}
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    ({selectedPlayerIds.size})
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    className="h-9 shrink-0 px-3 gap-1"
                    onClick={handleAddPlayersClick}
                  >
                    <Plus className="h-4 w-4" />
                    Add Player
                  </Button>
                  {(players?.length || 0) > 0 && (
                    <div className="relative shrink-0" data-vaul-no-drag>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground"
                        data-vaul-no-drag
                        aria-label="More options"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setHeaderMenuOpen(!headerMenuOpen); }}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                      {headerMenuOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-[100000]"
                            onPointerDown={(e) => { e.stopPropagation(); setHeaderMenuOpen(false); }}
                          />
                          <div className="absolute right-0 top-10 z-[100001] w-44 rounded-md border border-border bg-popover p-1 shadow-md">
                            <button
                              type="button"
                              className="flex w-full items-center rounded-sm px-2 py-2 text-sm text-popover-foreground hover:bg-accent"
                              onClick={(e) => { e.stopPropagation(); setHeaderMenuOpen(false); setSelectionMode(true); }}
                            >
                              <CheckSquare className="h-4 w-4 mr-2" />
                              Select players
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              )
            )}
          </div>

          {selectionMode && players && players.length > 0 && (
            <div className="flex items-center gap-2 py-2 border-b border-border">
              <Checkbox checked={selectedPlayerIds.size === players.length} onCheckedChange={toggleSelectAll} />
              <span className="text-sm text-muted-foreground">Select all ({players.length} players)</span>
            </div>
          )}

          {canDrag && players && players.length > 0 && (
            <p className="text-[11px] text-muted-foreground/70 flex items-center gap-1">
              <GripVertical className="h-3 w-3" />
              Hold and drag to move between groups
            </p>
          )}


          {playersLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : players?.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <Users className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground mb-3">No players added yet</p>
                {canManage && (
                  <Button size="sm" onClick={handleAddPlayersClick}>
                    Add Players
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="space-y-5" data-vaul-no-drag>
                {[0, 5, 4, 3, 2, 1].map((rating) => {
                  const abilityPlayers = playersByAbility[rating];
                  const showGroup = abilityPlayers?.length || activePlayer;
                  if (!showGroup) return null;

                  return (
                    <div key={rating}>
                      <div className="flex items-baseline gap-2 mb-2">
                        <Badge className={`text-xs ${getAbilityColor(rating)}`}>
                          {getAbilityLabel(rating)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {abilityPlayers?.length || 0} player{(abilityPlayers?.length || 0) !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <DroppableGroup rating={rating}>
                        {abilityPlayers?.map((player) => (
                          <DraggablePlayerCard key={player.id} player={player} canDrag={canDrag}>
                            {renderPlayerCard(player)}
                          </DraggablePlayerCard>
                        ))}
                        {!abilityPlayers?.length && activePlayer && (
                          <div className="border-2 border-dashed border-primary/30 rounded-lg py-6 text-center text-xs text-muted-foreground bg-primary/5">
                            Drop here to move to {getAbilityLabel(rating)}
                          </div>
                        )}
                      </DroppableGroup>
                    </div>
                  );
                })}
              </div>

              <DragOverlay dropAnimation={null} style={{ zIndex: 100000 }}>
                {activePlayer ? renderPlayerCard(activePlayer, true) : null}
              </DragOverlay>
            </DndContext>
          )}

          {/* Pending invites are surfaced inline on each player row via the
              "Pending" badge + invite-second-parent (UserPlus) button, so no
              separate "Pending Parent Invites" section is rendered here. */}

          <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {selectedPlayerIds.size} Players?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove {selectedPlayerIds.size} player{selectedPlayerIds.size !== 1 ? "s" : ""} from the player pool. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => bulkDeletePlayersMutation.mutate(Array.from(selectedPlayerIds))}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={bulkDeletePlayersMutation.isPending}
                >
                  {bulkDeletePlayersMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove All"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={!!deleteConfirmPlayer} onOpenChange={(o) => { if (!o) setDeleteConfirmPlayer(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove Player?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove {deleteConfirmPlayer?.name} from the player pool.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (deleteConfirmPlayer) deletePlayerMutation.mutate(deleteConfirmPlayer.id);
                    setDeleteConfirmPlayer(null);
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <ResponsiveDialogFooter className="px-4 pb-safe">
          <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Done
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>

      {secondParentForPlayer && (
        <Suspense fallback={null}>
        <AddSecondParentDialog
          open={!!secondParentForPlayer}
          onOpenChange={(o) => { if (!o) setSecondParentForPlayer(null); }}
          playerId={secondParentForPlayer.id}
          playerName={secondParentForPlayer.name}
          childId={secondParentForPlayer.child_id}
          miniLeagueId={miniLeagueId}
          miniLeagueName={miniLeagueName}
          clubId={clubId}
        />
        </Suspense>
      )}
    </ResponsiveDialog>
  );
}
