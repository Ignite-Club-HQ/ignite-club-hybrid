import { Pencil, Trash2, Check, X, Users, GripVertical, ArrowUpDown, AlertCircle } from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";

interface ParsedFixture {
  id: string;
  title: string;
  date: string;
  time: string;
  address?: string;
  description?: string;
  reminderHours?: number;
  teamName?: string;
  teamId?: string;
  existingEventId?: string;
  opponent?: string;
}

interface FixturePreviewEditorProps {
  fixtures: ParsedFixture[];
  onUpdate: (fixtures: ParsedFixture[]) => void;
  isDuplicate?: boolean;
}

interface GroupedFixtures {
  teamName: string;
  teamId?: string;
  fixtures: { fixture: ParsedFixture; originalIndex: number }[];
}

// Validation helpers
const isValidDate = (date: string): boolean => {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date);
  return !isNaN(parsed.getTime());
};

const isValidTime = (time: string): boolean => {
  if (!time) return false;
  const normalized = time.substring(0, 5);
  if (!/^\d{1,2}:\d{2}$/.test(normalized)) return false;
  const [hours, minutes] = normalized.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

const isFixtureValid = (fixture: ParsedFixture): boolean => {
  return fixture.title.trim().length > 0 && 
         isValidDate(fixture.date) && 
         isValidTime(fixture.time);
};

export function FixturePreviewEditor({ fixtures, onUpdate, isDuplicate = false }: FixturePreviewEditorProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ParsedFixture | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Group fixtures by team
  const groupedFixtures = useMemo(() => {
    const hasAnyTeam = fixtures.some(f => f.teamName);
    
    if (!hasAnyTeam) {
      return null;
    }

    const groups = new Map<string, GroupedFixtures>();
    
    fixtures.forEach((fixture, index) => {
      const key = fixture.teamName || '__no_team__';
      const teamName = fixture.teamName || 'No Team Assigned';
      
      if (!groups.has(key)) {
        groups.set(key, {
          teamName,
          teamId: fixture.teamId,
          fixtures: []
        });
      }
      groups.get(key)!.fixtures.push({ fixture, originalIndex: index });
    });

    return Array.from(groups.values()).sort((a, b) => {
      if (a.teamName === 'No Team Assigned') return 1;
      if (b.teamName === 'No Team Assigned') return -1;
      return a.teamName.localeCompare(b.teamName);
    });
  }, [fixtures]);

  const toggleGroup = (teamName: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(teamName)) {
        next.delete(teamName);
      } else {
        next.add(teamName);
      }
      return next;
    });
  };

  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setEditForm({ ...fixtures[index] });
  };

  const handleSave = () => {
    if (editingIndex === null || !editForm) return;
    
    if (!editForm.title.trim() || !editForm.date || !editForm.time) {
      return;
    }

    const updated = [...fixtures];
    updated[editingIndex] = editForm;
    onUpdate(updated);
    setEditingIndex(null);
    setEditForm(null);
  };

  const handleCancel = () => {
    setEditingIndex(null);
    setEditForm(null);
  };

  const handleDelete = (index: number) => {
    const updated = fixtures.filter((_, i) => i !== index);
    onUpdate(updated);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
    // Add a slight delay to allow the drag image to be set
    setTimeout(() => {
      (e.target as HTMLElement).style.opacity = '0.5';
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).style.opacity = '1';
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const updated = [...fixtures];
    const [draggedItem] = updated.splice(draggedIndex, 1);
    updated.splice(dropIndex, 0, draggedItem);
    
    onUpdate(updated);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleSortByDate = useCallback(() => {
    const sorted = [...fixtures].sort((a, b) => {
      const dateTimeA = new Date(`${a.date}T${a.time}`);
      const dateTimeB = new Date(`${b.date}T${b.time}`);
      return dateTimeA.getTime() - dateTimeB.getTime();
    });
    onUpdate(sorted);
  }, [fixtures, onUpdate]);

  const updateFixtureField = (fixtureId: string, field: keyof ParsedFixture, value: string) => {
    const updated = fixtures.map(f => 
      f.id === fixtureId ? { ...f, [field]: value } : f
    );
    onUpdate(updated);
  };

  const renderFixtureItem = (fixture: ParsedFixture, index: number, showTeamBadge: boolean = true, enableDrag: boolean = true) => {
    const isBeingDragged = draggedIndex === index;
    const isDragOver = dragOverIndex === index;
    const hasValidationErrors = !isFixtureValid(fixture);
    const titleMissing = !fixture.title.trim();
    const dateMissing = !isValidDate(fixture.date);
    const timeMissing = !isValidTime(fixture.time);
    
    return (
      <div
        key={fixture.id}
        draggable={enableDrag && editingIndex !== index}
        onDragStart={(e) => handleDragStart(e, index)}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => handleDragOver(e, index)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, index)}
        className={`p-3 rounded-lg border transition-all ${
          hasValidationErrors
            ? 'bg-destructive/10 border-destructive/50'
            : isDuplicate 
              ? 'bg-amber-500/5 border-amber-500/30' 
              : 'bg-muted/50 border-border'
        } ${
          isBeingDragged ? 'opacity-50 scale-95' : ''
        } ${
          isDragOver ? 'border-primary border-2 bg-primary/5' : ''
        } ${
          enableDrag && editingIndex !== index ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
      >
        {editingIndex === index && editForm ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Title *"
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                className="text-sm h-8"
              />
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={editForm.date}
                  onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                  className="text-sm h-8"
                />
                <Input
                  type="time"
                  value={editForm.time}
                  onChange={(e) => setEditForm({ ...editForm, time: e.target.value })}
                  className="text-sm h-8 w-24"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Opponent"
                value={editForm.opponent || ''}
                onChange={(e) => setEditForm({ ...editForm, opponent: e.target.value || undefined })}
                className="text-sm h-8"
              />
              <Input
                placeholder="Address"
                value={editForm.address || ''}
                onChange={(e) => setEditForm({ ...editForm, address: e.target.value || undefined })}
                className="text-sm h-8"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Description"
                value={editForm.description || ''}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value || undefined })}
                className="text-sm h-8"
              />
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  placeholder="Reminder"
                  value={editForm.reminderHours || ''}
                  onChange={(e) => setEditForm({ 
                    ...editForm, 
                    reminderHours: e.target.value ? parseInt(e.target.value, 10) : undefined 
                  })}
                  className="text-sm h-8 w-20"
                  min={0}
                />
                <span className="text-xs text-muted-foreground">hrs before</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={handleCancel} className="h-7 px-2">
                <X className="h-3 w-3" />
              </Button>
              <Button size="sm" onClick={handleSave} className="h-7 px-2">
                <Check className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            {enableDrag && (
              <div className="shrink-0 pt-0.5 text-muted-foreground/50 hover:text-muted-foreground">
                <GripVertical className="h-4 w-4" />
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-2">
              {/* Validation error banner */}
              {hasValidationErrors && (
                <div className="flex items-center gap-1.5 text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-xs font-medium">Missing required fields</span>
                </div>
              )}
              
              {/* Inline editable fields for invalid fixtures */}
              {hasValidationErrors ? (
                <div className="space-y-2">
                  {titleMissing ? (
                    <Input
                      placeholder="Enter title *"
                      value={fixture.title}
                      onChange={(e) => updateFixtureField(fixture.id, 'title', e.target.value)}
                      className="h-8 text-sm"
                    />
                  ) : (
                    <p className="font-medium text-sm truncate">{fixture.title}</p>
                  )}
                  
                  <div className="flex gap-2">
                    {dateMissing ? (
                      <Input
                        type="date"
                        placeholder="Date *"
                        value={fixture.date}
                        onChange={(e) => updateFixtureField(fixture.id, 'date', e.target.value)}
                        className="h-8 text-sm flex-1"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">{fixture.date}</span>
                    )}
                    
                    {timeMissing ? (
                      <Input
                        type="time"
                        placeholder="Time *"
                        value={fixture.time}
                        onChange={(e) => updateFixtureField(fixture.id, 'time', e.target.value)}
                        className="h-8 text-sm w-28"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">at {fixture.time}</span>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    {showTeamBadge && fixture.teamName && (
                      <div>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Team importing</span>
                        <p className="font-semibold text-sm text-foreground whitespace-normal break-words">{fixture.teamName}</p>
                      </div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm whitespace-normal break-words">{fixture.title}</span>
                    {isDuplicate && (
                      <Badge variant="outline" className="text-xs border-amber-500/30">
                        Existing
                      </Badge>
                    )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {fixture.date} at {fixture.time}
                    {fixture.opponent && ` vs ${fixture.opponent}`}
                    {fixture.address && ` • ${fixture.address}`}
                  </div>
                  {fixture.description && (
                    <div className="text-xs text-muted-foreground truncate">
                      {fixture.description}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleEdit(index)}
                className="h-7 w-7 p-0"
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(index)}
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (fixtures.length === 0) return null;

  // If no grouping needed, render flat list with drag-drop
  if (!groupedFixtures) {
    return (
      <div className="space-y-2">
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSortByDate}
            className="h-7 text-xs gap-1"
          >
            <ArrowUpDown className="h-3 w-3" />
            Sort by Date
          </Button>
        </div>
        <ScrollArea className="max-h-64">
          <div className="space-y-2 pr-4">
            {fixtures.map((fixture, index) => renderFixtureItem(fixture, index))}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Render grouped by team (drag-drop disabled in grouped view for simplicity)
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={handleSortByDate}
          className="h-7 text-xs gap-1"
        >
          <ArrowUpDown className="h-3 w-3" />
          Sort by Date
        </Button>
      </div>
      <ScrollArea className="max-h-80">
        <div className="space-y-3 pr-4">
          {groupedFixtures.map((group) => {
          const isCollapsed = collapsedGroups.has(group.teamName);
          const isNoTeam = group.teamName === 'No Team Assigned';
          
          return (
            <Collapsible
              key={group.teamName}
              open={!isCollapsed}
              onOpenChange={() => toggleGroup(group.teamName)}
            >
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className={`w-full justify-start gap-2 h-8 px-2 ${
                    isNoTeam ? 'text-amber-600 dark:text-amber-400' : ''
                  }`}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                  <Users className="h-4 w-4" />
                  <span className="font-medium text-sm">{group.teamName}</span>
                  <Badge variant="secondary" className="text-xs ml-auto">
                    {group.fixtures.length}
                  </Badge>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-2 mt-2 ml-6">
                  {group.fixtures.map(({ fixture, originalIndex }) => 
                    renderFixtureItem(fixture, originalIndex, false, false)
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
