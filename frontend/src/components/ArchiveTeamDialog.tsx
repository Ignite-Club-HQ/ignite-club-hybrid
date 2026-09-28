import { useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

interface ArchiveTeamDialogProps {
  teamId: string;
  teamName: string;
  clubId: string;
  isArchived: boolean;
  currentSeasonLabel?: string | null;
  /** Optional: called after successful archive/unarchive */
  onSuccess?: () => void;
  trigger?: React.ReactNode;
}

export function ArchiveTeamDialog({
  teamId,
  teamName,
  clubId,
  isArchived,
  currentSeasonLabel,
  onSuccess,
  trigger,
}: ArchiveTeamDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [seasonLabel, setSeasonLabel] = useState(currentSeasonLabel || "");
  const [loading, setLoading] = useState(false);

  const handleArchive = async () => {
    setLoading(true);
    const { error } = await supabase
      .from("teams")
      .update({
        is_archived: true,
        archived_at: new Date().toISOString(),
        season_label: seasonLabel.trim() || null,
      } as any)
      .eq("id", teamId);
    setLoading(false);

    if (error) {
      toast({ title: "Failed to archive team", variant: "destructive" });
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["club-teams", clubId] });
    queryClient.invalidateQueries({ queryKey: ["team", teamId] });
    toast({ title: "Team archived", description: `${teamName} has been archived${seasonLabel.trim() ? ` as "${seasonLabel.trim()}"` : ""}.` });
    onSuccess?.();
  };

  const handleReinstate = async () => {
    setLoading(true);
    const { error } = await supabase
      .from("teams")
      .update({
        is_archived: false,
        archived_at: null,
      } as any)
      .eq("id", teamId);
    setLoading(false);

    if (error) {
      toast({ title: "Failed to reinstate team", variant: "destructive" });
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["club-teams", clubId] });
    queryClient.invalidateQueries({ queryKey: ["team", teamId] });
    toast({ title: "Team reinstated", description: `${teamName} is now active again.` });
    onSuccess?.();
  };

  if (isArchived) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          {trigger || (
            <Button variant="outline" size="sm" className="text-green-600 border-green-600/40 hover:bg-green-50">
              <ArchiveRestore className="h-4 w-4 mr-2" />
              Reinstate Team
            </Button>
          )}
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reinstate "{teamName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will make the team active and visible to all members again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReinstate}
              disabled={loading}
              className="bg-green-600 text-white hover:bg-green-700"
            >
              Reinstate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="text-amber-600 border-amber-600/40 hover:bg-amber-50">
            <Archive className="h-4 w-4 mr-2" />
            Archive Team
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive "{teamName}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Archived teams are hidden from all members and cannot participate in events. Only admins can see and reinstate them. You can optionally tag this with a season label.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="px-1 py-2 space-y-2">
          <Label htmlFor="season-label" className="text-sm font-medium">
            Season label <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="season-label"
            placeholder="e.g. 2023/24, Season 5, U12 2022"
            value={seasonLabel}
            onChange={(e) => setSeasonLabel(e.target.value)}
            maxLength={50}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleArchive}
            disabled={loading}
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            <Archive className="h-4 w-4 mr-1" />
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
