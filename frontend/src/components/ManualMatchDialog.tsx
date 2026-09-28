import { useState, useMemo, useEffect } from "react";
import { Loader2, Plus, Shirt, Users, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";

interface Player {
  id: string;
  name: string;
  ability_rating: number;
}

interface ManualMatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (data: {
    name: string;
    pitchName: string;
    teamAPlayerIds: string[];
    teamBPlayerIds: string[];
  }) => void;
  isPending: boolean;
  availablePlayers: Player[];
  existingMatchCount: number;
}

export function ManualMatchDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
  availablePlayers,
  existingMatchCount,
}: ManualMatchDialogProps) {
  const defaultName = `Match ${existingMatchCount + 1}`;
  const [matchName, setMatchName] = useState("");
  const [pitchName, setPitchName] = useState("");
  const [teamAIds, setTeamAIds] = useState<Set<string>>(new Set());
  const [teamBIds, setTeamBIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (open) {
      setMatchName(`Match ${existingMatchCount + 1}`);
      setPitchName("");
      setTeamAIds(new Set());
      setTeamBIds(new Set());
      setSearchQuery("");
    }
  }, [open, existingMatchCount]);

  const unassignedPlayers = useMemo(() => {
    return availablePlayers.filter(
      (p) => !teamAIds.has(p.id) && !teamBIds.has(p.id)
    );
  }, [availablePlayers, teamAIds, teamBIds]);

  const filteredUnassigned = useMemo(() => {
    if (!searchQuery.trim()) return unassignedPlayers;
    const q = searchQuery.toLowerCase();
    return unassignedPlayers.filter((p) => p.name.toLowerCase().includes(q));
  }, [unassignedPlayers, searchQuery]);

  const teamAPlayers = availablePlayers.filter((p) => teamAIds.has(p.id));
  const teamBPlayers = availablePlayers.filter((p) => teamBIds.has(p.id));

  const addToTeamA = (id: string) => {
    setTeamBIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setTeamAIds((prev) => new Set(prev).add(id));
  };

  const addToTeamB = (id: string) => {
    setTeamAIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setTeamBIds((prev) => new Set(prev).add(id));
  };

  const removeFromTeam = (id: string) => {
    setTeamAIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setTeamBIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  };

  const handleSubmit = () => {
    onConfirm({
      name: matchName.trim() || defaultName,
      pitchName: pitchName.trim(),
      teamAPlayerIds: [...teamAIds],
      teamBPlayerIds: [...teamBIds],
    });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-lg" fullScreen>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            Create Match
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 px-1">
          {/* Match info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Match Name</Label>
              <Input
                placeholder={defaultName}
                value={matchName}
                onChange={(e) => setMatchName(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Pitch (optional)</Label>
              <Input
                placeholder="e.g. Pitch 1"
                value={pitchName}
                onChange={(e) => setPitchName(e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          {/* Teams side by side */}
          <div className="grid grid-cols-2 gap-2">
            {/* Team A */}
            <div className="rounded-xl border-2 border-red-500/30 overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-2 bg-red-500">
                <Shirt className="h-3.5 w-3.5 text-white" />
                <span className="text-xs font-bold text-white">Team A</span>
                <Badge variant="secondary" className="ml-auto text-[10px] h-5 px-1.5 bg-white/20 text-white border-0">
                  {teamAPlayers.length}
                </Badge>
              </div>
              <div className="p-1.5 min-h-[60px] space-y-0.5">
                {teamAPlayers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => removeFromTeam(p.id)}
                    className="w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-destructive/10 hover:line-through transition-all text-foreground"
                  >
                    {p.name}
                  </button>
                ))}
                {teamAPlayers.length === 0 && (
                  <p className="text-[10px] text-muted-foreground px-2 py-2 text-center">
                    Tap players below
                  </p>
                )}
              </div>
            </div>

            {/* Team B */}
            <div className="rounded-xl border-2 border-blue-500/30 overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-2 bg-blue-500">
                <Shirt className="h-3.5 w-3.5 text-white" />
                <span className="text-xs font-bold text-white">Team B</span>
                <Badge variant="secondary" className="ml-auto text-[10px] h-5 px-1.5 bg-white/20 text-white border-0">
                  {teamBPlayers.length}
                </Badge>
              </div>
              <div className="p-1.5 min-h-[60px] space-y-0.5">
                {teamBPlayers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => removeFromTeam(p.id)}
                    className="w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-destructive/10 hover:line-through transition-all text-foreground"
                  >
                    {p.name}
                  </button>
                ))}
                {teamBPlayers.length === 0 && (
                  <p className="text-[10px] text-muted-foreground px-2 py-2 text-center">
                    Tap players below
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Available players pool */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Available Players ({unassignedPlayers.length})
              </Label>
            </div>

            {availablePlayers.length > 8 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search players..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>
            )}

            <ScrollArea className="max-h-[200px]">
              <div className="space-y-0.5">
                {filteredUnassigned.map((player) => (
                  <div
                    key={player.id}
                    className="flex items-center gap-1.5 px-1"
                  >
                    <span className="text-xs flex-1 truncate py-1.5">
                      {player.name}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2.5 text-[10px] font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      onClick={() => addToTeamA(player.id)}
                    >
                      + A
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2.5 text-[10px] font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                      onClick={() => addToTeamB(player.id)}
                    >
                      + B
                    </Button>
                  </div>
                ))}
                {filteredUnassigned.length === 0 && unassignedPlayers.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    All players assigned
                  </p>
                )}
                {filteredUnassigned.length === 0 && unassignedPlayers.length > 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    No matches for "{searchQuery}"
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <ResponsiveDialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 sm:flex-none"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Create Match
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
