import { useState, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ArrowLeftRight, GripVertical, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { PitchPosition } from "./PositionBadge";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
}

interface SubstitutionEvent {
  time: number;
  half: 1 | 2;
  playerOut: Player;
  playerIn: Player;
  positionSwap?: {
    player: Player;
    fromPosition: PitchPosition;
    toPosition: PitchPosition;
  };
  executed?: boolean;
  skipped?: boolean;
}

interface SubPlanEditorProps {
  plan: SubstitutionEvent[];
  players: Player[];
  minutesPerHalf: number;
  teamSize: number;
  onPlanChange: (plan: SubstitutionEvent[]) => void;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

export default function SubPlanEditor({
  plan,
  players,
  minutesPerHalf,
  teamSize,
  onPlanChange,
}: SubPlanEditorProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newSubHalf, setNewSubHalf] = useState<1 | 2>(1);
  const [newSubMinute, setNewSubMinute] = useState(5);
  const [newSubPlayerOut, setNewSubPlayerOut] = useState<string>("");
  const [newSubPlayerIn, setNewSubPlayerIn] = useState<string>("");
  
  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

  const playersOnPitch = players.filter(p => p.position !== null);
  const benchPlayers = players.filter(p => p.position === null);

  // Calculate who will be on pitch/bench at any given time based on executed subs
  const getPlayersAtTime = (time: number, half: 1 | 2) => {
    let onPitch = new Set(playersOnPitch.map(p => p.id));
    let onBench = new Set(benchPlayers.map(p => p.id));
    
    for (const sub of plan) {
      if (sub.executed) continue;
      // Check if this sub happens before the given time
      const subTime = sub.half === 1 ? sub.time : sub.time + minutesPerHalf * 60;
      const checkTime = half === 1 ? time : time + minutesPerHalf * 60;
      
      if (subTime < checkTime) {
        onPitch.delete(sub.playerOut.id);
        onPitch.add(sub.playerIn.id);
        onBench.delete(sub.playerIn.id);
        onBench.add(sub.playerOut.id);
      }
    }
    
    return {
      onPitch: players.filter(p => onPitch.has(p.id)),
      onBench: players.filter(p => onBench.has(p.id)),
    };
  };

  const handleDeleteSub = (index: number) => {
    const newPlan = plan.filter((_, i) => i !== index);
    onPlanChange(newPlan);
  };

  const handleUpdateSubTime = (index: number, minutes: number, half: 1 | 2) => {
    const newPlan = [...plan];
    newPlan[index] = {
      ...newPlan[index],
      time: minutes * 60,
      half,
    };
    // Sort by time
    newPlan.sort((a, b) => {
      const aTime = a.half === 1 ? a.time : a.time + minutesPerHalf * 60;
      const bTime = b.half === 1 ? b.time : b.time + minutesPerHalf * 60;
      return aTime - bTime;
    });
    onPlanChange(newPlan);
    setEditingIndex(null);
  };

  const handleUpdateSubPlayers = (index: number, playerOutId: string, playerInId: string) => {
    const playerOut = players.find(p => p.id === playerOutId);
    const playerIn = players.find(p => p.id === playerInId);
    if (!playerOut || !playerIn) return;

    const newPlan = [...plan];
    newPlan[index] = {
      ...newPlan[index],
      playerOut,
      playerIn,
    };
    onPlanChange(newPlan);
  };

  const handleAddSub = () => {
    const playerOut = players.find(p => p.id === newSubPlayerOut);
    const playerIn = players.find(p => p.id === newSubPlayerIn);
    if (!playerOut || !playerIn) return;

    const newSub: SubstitutionEvent = {
      time: newSubMinute * 60,
      half: newSubHalf,
      playerOut,
      playerIn,
      executed: false,
    };

    const newPlan = [...plan, newSub].sort((a, b) => {
      const aTime = a.half === 1 ? a.time : a.time + minutesPerHalf * 60;
      const bTime = b.half === 1 ? b.time : b.time + minutesPerHalf * 60;
      return aTime - bTime;
    });

    onPlanChange(newPlan);
    setShowAddDialog(false);
    setNewSubPlayerOut("");
    setNewSubPlayerIn("");
    setNewSubMinute(5);
    setNewSubHalf(1);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDraggedIndex(index);
    dragNodeRef.current = e.currentTarget;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index.toString());
    // Add a slight delay to allow the drag image to be captured
    setTimeout(() => {
      if (dragNodeRef.current) {
        dragNodeRef.current.style.opacity = "0.5";
      }
    }, 0);
  };

  const handleDragEnd = () => {
    if (dragNodeRef.current) {
      dragNodeRef.current.style.opacity = "1";
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
    dragNodeRef.current = null;
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDragOverIndex(null);
      return;
    }

    const newPlan = [...plan];
    const draggedItem = newPlan[draggedIndex];
    
    // Remove from old position and insert at new position
    newPlan.splice(draggedIndex, 1);
    newPlan.splice(dropIndex, 0, draggedItem);
    
    // Update times to match new order (assign sequential times)
    const sortedPlan = newPlan.map((sub, idx) => {
      // Keep executed subs as-is, only reorder non-executed ones
      if (sub.executed) return sub;
      return sub;
    });
    
    onPlanChange(sortedPlan);
    setDragOverIndex(null);
    setDraggedIndex(null);
  };

  // Get available players for new sub (at the selected time)
  const availablePlayersForNewSub = useMemo(() => {
    return getPlayersAtTime(newSubMinute * 60, newSubHalf);
  }, [newSubMinute, newSubHalf, plan, players]);

  // Generate time options
  const timeOptions = useMemo(() => {
    const options: { value: number; label: string }[] = [];
    for (let i = 1; i <= minutesPerHalf; i++) {
      options.push({ value: i, label: `${i}'` });
    }
    return options;
  }, [minutesPerHalf]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {plan.length} sub{plan.length !== 1 ? "s" : ""} planned · {new Set([...plan.map(s => s.playerOut.id), ...plan.map(s => s.playerIn.id)]).size} players
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowAddDialog(!showAddDialog)}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Sub
        </Button>
      </div>

      {/* Add new sub form */}
      {showAddDialog && (
        <div className="p-2 sm:p-3 rounded-lg bg-muted/50 border border-border space-y-2 sm:space-y-3">
          <p className="text-sm font-medium">Add Substitution</p>
          
          <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Half</label>
              <Select value={newSubHalf.toString()} onValueChange={(v) => setNewSubHalf(parseInt(v) as 1 | 2)}>
                <SelectTrigger className="h-8 text-xs sm:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[999999]">
                  <SelectItem value="1">1st Half</SelectItem>
                  <SelectItem value="2">2nd Half</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Time</label>
              <Select value={newSubMinute.toString()} onValueChange={(v) => setNewSubMinute(parseInt(v))}>
                <SelectTrigger className="h-8 text-xs sm:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[999999] max-h-48">
                  {timeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value.toString()}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
            <div className="min-w-0">
              <label className="text-xs text-muted-foreground mb-1 block">Out</label>
              <Select value={newSubPlayerOut} onValueChange={setNewSubPlayerOut}>
                <SelectTrigger className="h-8 text-xs sm:text-sm">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent className="z-[999999] max-h-48">
                  {availablePlayersForNewSub.onPitch.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.number ? `#${p.number} ` : ""}{p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <label className="text-xs text-muted-foreground mb-1 block">In</label>
              <Select value={newSubPlayerIn} onValueChange={setNewSubPlayerIn}>
                <SelectTrigger className="h-8 text-xs sm:text-sm">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent className="z-[999999] max-h-48">
                  {availablePlayersForNewSub.onBench.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.number ? `#${p.number} ` : ""}{p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button 
              size="sm" 
              onClick={handleAddSub}
              disabled={!newSubPlayerOut || !newSubPlayerIn}
            >
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Substitution list */}
      <div>
        <div className="space-y-4">
          {[1, 2].map((half) => {
            const halfSubs = plan.filter((s) => s.half === half && !s.executed);
            
            // Group subs by time
            const groupedSubs: { time: number; subs: { sub: SubstitutionEvent; globalIndex: number }[] }[] = [];
            halfSubs.forEach((sub) => {
              const globalIndex = plan.findIndex((s) => s === sub);
              const existing = groupedSubs.find(g => g.time === sub.time);
              if (existing) {
                existing.subs.push({ sub, globalIndex });
              } else {
                groupedSubs.push({ time: sub.time, subs: [{ sub, globalIndex }] });
              }
            });
            groupedSubs.sort((a, b) => a.time - b.time);
            
            return (
              <div key={half}>
                <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  {half === 1 ? "1st Half" : "2nd Half"}
                  <Badge variant="outline" className="text-xs">{halfSubs.length}</Badge>
                </h4>

                {halfSubs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No substitutions</p>
                ) : (
                  <div className="space-y-2">
                    {groupedSubs.map((group) => (
                      <div key={`${half}-${group.time}`} className="flex gap-2">
                        {/* Time column - shown once per group */}
                        <div className="flex flex-col items-center pt-2 shrink-0 w-14">
                          <Badge
                            className="font-mono text-xs cursor-pointer border-transparent bg-foreground/15 text-foreground hover:bg-foreground/25"
                            onClick={() => setEditingIndex(group.subs[0].globalIndex)}
                          >
                            {group.time === 0 && half === 2 ? "HT" : formatTime(group.time)}
                          </Badge>
                          {group.subs.length > 1 && (
                            <div className="w-px flex-1 bg-border mt-1" />
                          )}
                        </div>
                        
                        {/* Subs column */}
                        <div className="flex-1 space-y-1">
                          {group.subs.map(({ sub, globalIndex }) => {
                            const isEditing = editingIndex === globalIndex;
                            const isDragging = draggedIndex === globalIndex;
                            const isDragOver = dragOverIndex === globalIndex;

                            return (
                              <div
                                key={globalIndex}
                                draggable={!isEditing}
                                onDragStart={(e) => handleDragStart(e, globalIndex)}
                                onDragEnd={handleDragEnd}
                                onDragOver={(e) => handleDragOver(e, globalIndex)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, globalIndex)}
                                className={cn(
                                  "flex items-center gap-2 p-1.5 rounded-lg text-xs transition-all",
                                  isEditing ? "bg-primary/10 border border-primary/30" : "bg-muted/50",
                                  isDragging && "opacity-50",
                                  isDragOver && "border-2 border-dashed border-primary bg-primary/5",
                                  !isEditing && "cursor-grab active:cursor-grabbing"
                                )}
                              >
                                <GripVertical className="h-3 w-3 text-muted-foreground shrink-0" />

                                {/* Player swap display */}
                                <div className="flex items-center gap-1 flex-1 min-w-0">
                                  {isEditing ? (
                                    <>
                                      <Select
                                        value={sub.playerOut.id}
                                        onValueChange={(v) => handleUpdateSubPlayers(globalIndex, v, sub.playerIn.id)}
                                      >
                                        <SelectTrigger className="h-6 text-xs flex-1">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="z-[999999] max-h-40">
                                          {players.filter(p => p.position !== null).map((p) => (
                                            <SelectItem key={p.id} value={p.id}>
                                              {p.number ? `#${p.number} ` : ""}{p.name}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      <ArrowLeftRight className="h-3 w-3 shrink-0" />
                                      <Select
                                        value={sub.playerIn.id}
                                        onValueChange={(v) => handleUpdateSubPlayers(globalIndex, sub.playerOut.id, v)}
                                      >
                                        <SelectTrigger className="h-6 text-xs flex-1">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="z-[999999] max-h-40">
                                          {players.filter(p => p.position === null).map((p) => (
                                            <SelectItem key={p.id} value={p.id}>
                                              {p.number ? `#${p.number} ` : ""}{p.name}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </>
                                  ) : (
                                    <div className="flex flex-col gap-0.5 min-w-0">
                                      <div className="flex items-center gap-1">
                                        <span className="text-destructive truncate">
                                          ↓ {sub.playerOut.name}
                                        </span>
                                        <ArrowLeftRight className="h-3 w-3 mx-0.5 shrink-0" />
                                        <span className="text-emerald-500 truncate">
                                          ↑ {sub.playerIn.name}
                                        </span>
                                      </div>
                                      {sub.positionSwap && (
                                        <span className="text-[10px] text-muted-foreground">
                                          {sub.positionSwap.player.name} moves {sub.positionSwap.fromPosition} → {sub.positionSwap.toPosition}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Edit/Delete buttons */}
                                <div className="flex gap-1 shrink-0">
                                  {isEditing ? (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6"
                                      onClick={() => setEditingIndex(null)}
                                    >
                                      <Clock className="h-3 w-3" />
                                    </Button>
                                  ) : (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6 hover:bg-destructive/20 hover:text-destructive"
                                      onClick={() => handleDeleteSub(globalIndex)}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
