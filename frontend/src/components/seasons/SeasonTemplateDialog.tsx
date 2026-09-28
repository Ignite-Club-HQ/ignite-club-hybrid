import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Copy } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubId: string;
  sourceSeasonId: string;
  sourceSeasonName: string;
}

export function SeasonTemplateDialog({
  open,
  onOpenChange,
  clubId,
  sourceSeasonId,
  sourceSeasonName,
}: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const createMut = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Season name is required");
      const { data, error } = await supabase.rpc("create_season_from_template", {
        _source_season_id: sourceSeasonId,
        _new_name: name.trim(),
        _start_date: startDate || null,
        _end_date: endDate || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (newSeasonId) => {
      toast.success("Season created from template");
      qc.invalidateQueries({ queryKey: ["club-seasons", clubId] });
      onOpenChange(false);
      setName("");
      setStartDate("");
      setEndDate("");
      navigate(`/clubs/${clubId}/seasons/${newSeasonId}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Use as template
          </DialogTitle>
          <DialogDescription>
            Creates a new draft season with the same team structure (name, sport, age group) as{" "}
            <strong>{sourceSeasonName}</strong>. Rosters start empty — you can assign players after.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="season-name">Season name</Label>
            <Input
              id="season-name"
              placeholder="e.g. 2026 Winter Season"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">End date</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !name.trim()}>
            {createMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create draft season
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
