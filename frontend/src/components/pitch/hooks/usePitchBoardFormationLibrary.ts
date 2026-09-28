import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Canvas as FabricCanvas } from "fabric";
import { useToast } from "@/hooks/use-toast";
import { Player, TeamSize, getPositionFromCoords } from "@/components/pitch/types";

// Minimal structural surface this hook needs from the Supabase client, so the
// caller can pass its existing client instance without this module adding
// its own direct integration import.
interface PitchFormationsSupabaseClient {
  from: (table: string) => any;
}

interface UsePitchBoardFormationLibraryArgs {
  teamId: string;
  teamSize: TeamSize;
  players: Player[];
  fabricCanvas: FabricCanvas | null;
  saveDialogOpen: boolean;
  loadDialogOpen: boolean;
  formationName: string;
  userId: string | undefined;
  supabaseClient: PitchFormationsSupabaseClient;
  setTeamSize: (size: TeamSize) => void;
  setPlayers: (updater: (prev: Player[]) => Player[]) => void;
  setSaveDialogOpen: (open: boolean) => void;
  setLoadDialogOpen: (open: boolean) => void;
  setFormationName: (name: string) => void;
}

/**
 * Owns the named-formation save/load library backed by the `pitch_formations`
 * table: the lazy dialog-gated fetch, save/delete mutations, and applying a
 * saved formation (player positions + optional Fabric drawing overlay) back
 * onto the board.
 */
export function usePitchBoardFormationLibrary({
  teamId,
  teamSize,
  players,
  fabricCanvas,
  saveDialogOpen,
  loadDialogOpen,
  formationName,
  userId,
  supabaseClient,
  setTeamSize,
  setPlayers,
  setSaveDialogOpen,
  setLoadDialogOpen,
  setFormationName,
}: UsePitchBoardFormationLibraryArgs) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch saved formations - lazy load only when save/load dialog is opened
  const { data: savedFormations, isLoading: loadingFormations } = useQuery({
    queryKey: ["pitch-formations", teamId],
    queryFn: async () => {
      const { data, error } = await supabaseClient
        .from("pitch_formations")
        .select("*, profiles:created_by(display_name)")
        .eq("team_id", teamId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: saveDialogOpen || loadDialogOpen, // Only fetch when dialogs are open
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });

  // Save formation mutation
  const saveFormationMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!userId) throw new Error("Not authenticated");

      const formationData = players.map((p) => ({
        id: p.id,
        name: p.name,
        number: p.number,
        position: p.position,
        assignedPositions: p.assignedPositions,
        currentPitchPosition: p.currentPitchPosition,
      }));

      const drawingData = fabricCanvas ? JSON.stringify(fabricCanvas.toJSON()) : null;

      const { error } = await supabaseClient.from("pitch_formations").insert({
        team_id: teamId,
        name,
        team_size: parseInt(teamSize),
        formation_data: formationData,
        drawing_data: drawingData,
        created_by: userId,
      } as never);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pitch-formations", teamId] });
      toast({ title: "Formation saved", description: "Your formation has been saved successfully" });
      setSaveDialogOpen(false);
      setFormationName("");
    },
    onError: (error: any) => {
      toast({ title: "Error saving formation", description: error.message, variant: "destructive" });
    },
  });

  // Delete formation mutation
  const deleteFormationMutation = useMutation({
    mutationFn: async (formationId: string) => {
      const { error } = await supabaseClient
        .from("pitch_formations")
        .delete()
        .eq("id", formationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pitch-formations", teamId] });
      toast({ title: "Formation deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Error deleting formation", description: error.message, variant: "destructive" });
    },
  });

  // Load a saved formation
  const loadFormation = useCallback(
    (formation: any) => {
      // Set team size
      setTeamSize(formation.team_size.toString() as TeamSize);

      // Load player positions
      const formationData = formation.formation_data as Player[];
      setPlayers((prev) =>
        prev.map((p) => {
          const savedPlayer = formationData.find((fp) => fp.id === p.id);
          if (savedPlayer) {
            return {
              ...p,
              position: savedPlayer.position,
              assignedPositions: savedPlayer.assignedPositions || p.assignedPositions,
              currentPitchPosition:
                savedPlayer.currentPitchPosition ||
                (savedPlayer.position
                  ? getPositionFromCoords(savedPlayer.position.y, formation.team_size.toString() as TeamSize)
                  : undefined),
            };
          }
          return { ...p, position: null, currentPitchPosition: undefined };
        })
      );

      // Load drawings
      if (formation.drawing_data && fabricCanvas) {
        try {
          const drawingJson = JSON.parse(formation.drawing_data);
          fabricCanvas.loadFromJSON(drawingJson).then(() => {
            fabricCanvas.renderAll();
          });
        } catch (e) {
          console.error("Error loading drawings:", e);
        }
      }

      setLoadDialogOpen(false);
      toast({ title: "Formation loaded", description: `Loaded "${formation.name}"` });
    },
    [fabricCanvas, toast, setTeamSize, setPlayers, setLoadDialogOpen]
  );

  const handleSaveFormation = useCallback(() => {
    if (!formationName.trim()) {
      toast({ title: "Please enter a name", variant: "destructive" });
      return;
    }
    saveFormationMutation.mutate(formationName.trim());
  }, [formationName, toast, saveFormationMutation]);

  return {
    savedFormations,
    loadingFormations,
    saveFormationMutation,
    deleteFormationMutation,
    loadFormation,
    handleSaveFormation,
  };
}
