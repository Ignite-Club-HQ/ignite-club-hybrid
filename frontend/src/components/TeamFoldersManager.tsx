import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Folder, Plus, Pencil, Trash2, GripVertical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { CreateTeamFolderDialog } from "@/components/CreateTeamFolderDialog";

interface TeamFolder {
  id: string;
  club_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  color: string;
  created_at: string;
}

export const FOLDER_COLORS = [
  { value: "default", label: "Default", className: "text-primary", bgClassName: "bg-primary/10" },
  { value: "blue", label: "Blue", className: "text-blue-500", bgClassName: "bg-blue-500/10" },
  { value: "green", label: "Green", className: "text-emerald-500", bgClassName: "bg-emerald-500/10" },
  { value: "purple", label: "Purple", className: "text-purple-500", bgClassName: "bg-purple-500/10" },
  { value: "orange", label: "Orange", className: "text-orange-500", bgClassName: "bg-orange-500/10" },
  { value: "red", label: "Red", className: "text-red-500", bgClassName: "bg-red-500/10" },
  { value: "pink", label: "Pink", className: "text-pink-500", bgClassName: "bg-pink-500/10" },
  { value: "yellow", label: "Yellow", className: "text-yellow-500", bgClassName: "bg-yellow-500/10" },
] as const;

export const getFolderColorClass = (color: string) => {
  return FOLDER_COLORS.find(c => c.value === color) || FOLDER_COLORS[0];
};

interface TeamFoldersManagerProps {
  clubId: string;
  isAdmin: boolean;
  classMode?: boolean;
}

export default function TeamFoldersManager({ clubId, isAdmin, classMode = false }: TeamFoldersManagerProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<TeamFolder | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [folderColor, setFolderColor] = useState("default");

  const { data: folders = [], isLoading } = useQuery({
    queryKey: ["team-folders", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_folders")
        .select("*")
        .eq("club_id", clubId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as TeamFolder[];
    },
    enabled: !!clubId,
  });

  const createFolderMutation = useMutation({
    mutationFn: async (params: { name: string; description: string; color: string }) => {
      const { error } = await supabase.from("team_folders").insert({
        club_id: clubId,
        name: params.name,
        description: params.description || null,
        color: params.color,
        sort_order: folders.length,
        created_by: user?.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-folders", clubId] });
      setCreateDialogOpen(false);
      toast({ title: "Folder created" });
    },
    onError: () => {
      toast({ title: "Failed to create folder", variant: "destructive" });
    },
  });

  const updateFolderMutation = useMutation({
    mutationFn: async () => {
      if (!editingFolder) return;
      const { error } = await supabase
        .from("team_folders")
        .update({
          name: folderName.trim(),
          description: folderDescription.trim() || null,
          color: folderColor,
        })
        .eq("id", editingFolder.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-folders", clubId] });
      setEditingFolder(null);
      setFolderName("");
      setFolderDescription("");
      setFolderColor("default");
      toast({ title: "Folder updated" });
    },
    onError: () => {
      toast({ title: "Failed to update folder", variant: "destructive" });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId: string) => {
      const { error } = await supabase
        .from("team_folders")
        .delete()
        .eq("id", folderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-folders", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club-teams", clubId] });
      toast({ title: "Folder deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete folder", variant: "destructive" });
    },
  });

  const reorderFoldersMutation = useMutation({
    mutationFn: async (reorderedFolders: { id: string; sort_order: number }[]) => {
      const updates = reorderedFolders.map(({ id, sort_order }) =>
        supabase.from("team_folders").update({ sort_order }).eq("id", id)
      );
      const results = await Promise.all(updates);
      const error = results.find((r) => r.error)?.error;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-folders", clubId] });
    },
    onError: () => {
      toast({ title: "Failed to reorder folders", variant: "destructive" });
    },
  });

  const draggedItemRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, folderId: string) => {
    draggedItemRef.current = folderId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", folderId);
  };

  const handleDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (draggedItemRef.current !== folderId) {
      setDragOverId(folderId);
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    setDragOverId(null);
    const draggedId = draggedItemRef.current;
    if (!draggedId || draggedId === targetFolderId) return;

    const draggedIndex = folders.findIndex((f) => f.id === draggedId);
    const targetIndex = folders.findIndex((f) => f.id === targetFolderId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    const newFolders = [...folders];
    const [removed] = newFolders.splice(draggedIndex, 1);
    newFolders.splice(targetIndex, 0, removed);

    const reordered = newFolders.map((f, idx) => ({ id: f.id, sort_order: idx }));
    reorderFoldersMutation.mutate(reordered);
    draggedItemRef.current = null;
  };

  const handleDragEnd = () => {
    draggedItemRef.current = null;
    setDragOverId(null);
  };

  const handleOpenEdit = (folder: TeamFolder) => {
    setEditingFolder(folder);
    setFolderName(folder.name);
    setFolderDescription(folder.description || "");
    setFolderColor(folder.color || "default");
  };

  const handleCloseEdit = () => {
    setEditingFolder(null);
    setFolderName("");
    setFolderDescription("");
    setFolderColor("default");
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground font-medium">{classMode ? "Class Folders" : "Team Folders"}</p>
        <Button variant="outline" size="sm" onClick={() => setCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Folder
        </Button>
        <CreateTeamFolderDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onCreateFolder={(name, description, color) => 
            createFolderMutation.mutate({ name, description, color })
          }
          isCreating={createFolderMutation.isPending}
          classMode={classMode}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading folders...</p>
      ) : folders.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-4 text-center">
            <Folder className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              No folders yet. Create folders to organize your teams (e.g., "Junior Teams", "Senior Teams").
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {folders.map((folder) => {
            const colorInfo = getFolderColorClass(folder.color);
            return (
            <Card 
              key={folder.id} 
              className={`transition-all ${colorInfo.bgClassName} ${dragOverId === folder.id ? "ring-2 ring-primary ring-offset-2" : ""}`}
              draggable
              onDragStart={(e) => handleDragStart(e, folder.id)}
              onDragOver={(e) => handleDragOver(e, folder.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, folder.id)}
              onDragEnd={handleDragEnd}
            >
              <CardContent className="p-3 flex items-center gap-3">
                <GripVertical className="h-5 w-5 text-muted-foreground shrink-0 cursor-grab active:cursor-grabbing" />
                <Folder className={`h-5 w-5 shrink-0 ${colorInfo.className}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{folder.name}</p>
                  {folder.description && (
                    <p className="text-xs text-muted-foreground truncate">{folder.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleOpenEdit(folder)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Folder?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will delete the folder "{folder.name}". Teams in this folder will become uncategorized.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteFolderMutation.mutate(folder.id)}
                          className="bg-destructive text-destructive-foreground"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      {/* Edit Dialog */}
      <ResponsiveDialog open={!!editingFolder} onOpenChange={(open) => !open && handleCloseEdit()}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Edit Folder</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>

          <div className="py-6 space-y-6">
            {/* Icon */}
            <div className="flex justify-center">
              <div className={`h-20 w-20 rounded-2xl flex items-center justify-center ${getFolderColorClass(folderColor).bgClassName}`}>
                <Folder className={`h-10 w-10 ${getFolderColorClass(folderColor).className}`} />
              </div>
            </div>

            {/* Folder Name Input */}
            <div className="space-y-2">
              <Input
                id="edit-folder-name"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                className="text-center text-lg h-12"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && folderName.trim() && !updateFolderMutation.isPending) {
                    updateFolderMutation.mutate();
                  }
                }}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="edit-folder-description" className="text-sm font-medium">
                Description (optional)
              </Label>
              <Textarea
                id="edit-folder-description"
                value={folderDescription}
                onChange={(e) => setFolderDescription(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>

            {/* Color Selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Folder Color</Label>
              <div className="flex flex-wrap justify-center gap-3">
                {FOLDER_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    onClick={() => setFolderColor(color.value)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${color.bgClassName} ${
                      folderColor === color.value ? "ring-2 ring-offset-2 ring-primary scale-110" : "hover:scale-105"
                    }`}
                  >
                    <Folder className={`h-5 w-5 ${color.className}`} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <ResponsiveDialogFooter className="gap-2 sm:gap-0">
            <Button 
              variant="outline" 
              onClick={handleCloseEdit}
              className="flex-1 sm:flex-none"
            >
              Cancel
            </Button>
            <Button 
              onClick={() => updateFolderMutation.mutate()}
              disabled={!folderName.trim() || updateFolderMutation.isPending}
              className="flex-1 sm:flex-none"
            >
              {updateFolderMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
