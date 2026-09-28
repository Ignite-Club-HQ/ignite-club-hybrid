import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PitchPosition, POSITION_LABELS, POSITION_COLORS } from "./PositionBadge";
import { cn } from "@/lib/utils";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
}

interface PlayerPositionEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: Player[];
  onUpdatePositions: (playerId: string, positions: PitchPosition[]) => void;
}

export default function PlayerPositionEditor({
  open,
  onOpenChange,
  players,
  onUpdatePositions,
}: PlayerPositionEditorProps) {
  const [editingPlayer, setEditingPlayer] = useState<string | null>(null);
  const [selectedPositions, setSelectedPositions] = useState<PitchPosition[]>([]);

  const handlePlayerClick = (player: Player) => {
    setEditingPlayer(player.id);
    setSelectedPositions(player.assignedPositions || []);
  };

  const handlePositionToggle = (position: PitchPosition) => {
    setSelectedPositions(prev => 
      prev.includes(position)
        ? prev.filter(p => p !== position)
        : [...prev, position]
    );
  };

  const handleSave = () => {
    if (editingPlayer) {
      onUpdatePositions(editingPlayer, selectedPositions);
    }
    setEditingPlayer(null);
    setSelectedPositions([]);
  };

  const handleBack = () => {
    setEditingPlayer(null);
    setSelectedPositions([]);
  };

  const currentPlayer = players.find(p => p.id === editingPlayer);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-md landscape:max-w-2xl max-h-[100dvh] sm:max-h-[80vh] landscape:max-h-[85vh] h-[100dvh] sm:h-auto landscape:h-auto w-full sm:w-auto landscape:w-[90vw] rounded-none sm:rounded-lg landscape:rounded-lg overflow-y-auto landscape:p-4 sm:pt-6 landscape:pt-4 pb-[env(safe-area-inset-bottom,0px)]" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.5rem)' }}>
        <DialogHeader>
          <DialogTitle>
            {editingPlayer ? `Edit Positions: ${currentPlayer?.name}` : "Assign Player Positions"}
          </DialogTitle>
        </DialogHeader>
        
        {editingPlayer ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select all positions this player can play:
            </p>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(POSITION_LABELS) as PitchPosition[]).map(position => {
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
                    <Checkbox 
                      checked={isSelected}
                      className="pointer-events-none"
                    />
                    <div className="text-left">
                      <div className={cn("font-bold", isSelected ? colors.text : "text-foreground")}>
                        {position}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {POSITION_LABELS[position]}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={handleBack} className="flex-1">
                Back
              </Button>
              <Button onClick={handleSave} className="flex-1">
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {(() => { const seen = new Set<string>(); return players.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; }); })().map(player => (
              <button
                key={player.id}
                onClick={() => handlePlayerClick(player)}
                className="w-full flex items-center justify-between p-3 rounded-lg border border-border bg-muted/50 hover:bg-muted transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                    {player.number || player.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="font-medium">{player.name}</span>
                </div>
                <div className="flex gap-1">
                  {player.assignedPositions?.length ? (
                    player.assignedPositions.map(pos => {
                      const colors = POSITION_COLORS[pos];
                      return (
                        <span
                          key={pos}
                          className={cn(
                            "text-[10px] font-bold px-1.5 py-0.5 rounded",
                            colors.bg,
                            colors.text
                          )}
                        >
                          {pos}
                        </span>
                      );
                    })
                  ) : (
                    <span className="text-xs text-muted-foreground">No positions</span>
                  )}
                </div>
              </button>
            ))}
            <Button variant="outline" className="w-full mt-4" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4 mr-2" />
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
