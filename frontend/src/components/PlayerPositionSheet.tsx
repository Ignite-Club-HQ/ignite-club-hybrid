import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const POSITION_LABELS: Record<string, string> = {
  GK: "Goalkeeper",
  DEF: "Defender",
  MID: "Midfielder",
  FWD: "Forward",
};

const POSITION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  GK: { bg: "bg-amber-500/20", text: "text-amber-400", border: "border-amber-500" },
  DEF: { bg: "bg-blue-500/20", text: "text-blue-400", border: "border-blue-500" },
  MID: { bg: "bg-emerald-500/20", text: "text-emerald-400", border: "border-emerald-500" },
  FWD: { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500" },
};

type PitchPosition = "GK" | "DEF" | "MID" | "FWD";

interface PlayerPositionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  playerId: string;
  playerName: string;
  playerType: "member" | "child";
}

export default function PlayerPositionSheet({
  open,
  onOpenChange,
  teamId,
  playerId,
  playerName,
  playerType,
}: PlayerPositionSheetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedPositions, setSelectedPositions] = useState<PitchPosition[]>([]);
  const [jerseyNumber, setJerseyNumber] = useState("");

  const { data: positionData, isLoading } = useQuery({
    queryKey: ["player-position", teamId, playerType, playerId],
    queryFn: async () => {
      let query = supabase
        .from("team_player_positions")
        .select("*")
        .eq("team_id", teamId);

      if (playerType === "child") {
        query = query.eq("child_id", playerId);
      } else {
        query = query.eq("user_id", playerId);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  useEffect(() => {
    if (positionData) {
      setSelectedPositions((positionData.preferred_positions || []) as PitchPosition[]);
      setJerseyNumber(positionData.jersey_number?.toString() || "");
    } else {
      setSelectedPositions([]);
      setJerseyNumber("");
    }
  }, [positionData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        team_id: teamId,
        position: selectedPositions[0] || "MID",
        preferred_positions: selectedPositions,
        jersey_number: jerseyNumber ? parseInt(jerseyNumber) : null,
      };

      if (playerType === "child") {
        payload.child_id = playerId;
        payload.user_id = null;
      } else {
        payload.user_id = playerId;
        payload.child_id = null;
      }

      if (positionData?.id) {
        const { error } = await supabase
          .from("team_player_positions")
          .update(payload)
          .eq("id", positionData.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("team_player_positions")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-player-positions", teamId] });
      queryClient.invalidateQueries({ queryKey: ["player-position", teamId, playerType, playerId] });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Failed to save", variant: "destructive" });
    },
  });

  const handlePositionToggle = (position: PitchPosition) => {
    setSelectedPositions((prev) =>
      prev.includes(position)
        ? prev.filter((p) => p !== position)
        : [...prev, position]
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[70vh]">
        <SheetHeader>
          <SheetTitle className="text-left">{playerName}</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label className="text-sm">Shirt Number</Label>
              <Input
                type="number"
                inputMode="numeric"
                placeholder="e.g. 10"
                value={jerseyNumber}
                onChange={(e) => setJerseyNumber(e.target.value)}
                className="w-24 h-10"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Preferred Positions</Label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(POSITION_LABELS) as PitchPosition[]).map((position) => {
                  const colors = POSITION_COLORS[position];
                  const isSelected = selectedPositions.includes(position);

                  return (
                    <button
                      key={position}
                      onClick={() => handlePositionToggle(position)}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border-2 transition-all",
                        isSelected
                          ? `${colors.border} ${colors.bg}`
                          : "border-border bg-muted/50 hover:bg-muted"
                      )}
                    >
                      <Checkbox checked={isSelected} className="pointer-events-none" />
                      <div className="text-left">
                        <div className={cn("font-bold text-sm", isSelected ? colors.text : "text-foreground")}>
                          {position}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {POSITION_LABELS[position]}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="w-full"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
