import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowRight, ArrowLeft, CheckCircle2, Rocket, Sparkles } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Season } from "@/hooks/useClubSeasons";
import { ReturningMembersStep } from "./ReturningMembersStep";
import { SeasonInviteStep } from "./SeasonInviteStep";

interface Props {
  clubId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentSeason: Season | undefined;
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

export function StartNewSeasonWizard({ clubId, open, onOpenChange, currentSeason, onComplete }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [archiveCurrent, setArchiveCurrent] = useState(true);
  const [seasonName, setSeasonName] = useState("");
  const [duplicateStructure, setDuplicateStructure] = useState(true);
  const [copyStaff, setCopyStaff] = useState(true);
  const [createdSeasonId, setCreatedSeasonId] = useState<string | null>(null);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Record<string, string | null>>({});
  const [carriedOverCount, setCarriedOverCount] = useState<number | null>(null);
  const qc = useQueryClient();

  const reset = () => {
    setStep(1);
    setArchiveCurrent(true);
    setSeasonName("");
    setDuplicateStructure(true);
    setCopyStaff(true);
    setCreatedSeasonId(null);
    setSelectedPlayerIds(new Set());
    setAssignments({});
    setCarriedOverCount(null);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const archiveMut = useMutation({
    mutationFn: async () => {
      if (!currentSeason || !archiveCurrent) return;
      const { error } = await supabase.rpc("archive_season", { _season_id: currentSeason.id });
      if (error) throw error;
    },
  });

  const createMut = useMutation({
    mutationFn: async (): Promise<string> => {
      if (duplicateStructure && currentSeason) {
        const { data, error } = await supabase.rpc("duplicate_season_structure", {
          _source_season_id: currentSeason.id,
          _new_season_name: seasonName.trim(),
          _copy_staff: copyStaff,
        });
        if (error) throw error;
        return data as string;
      }
      const { data, error } = await supabase
        .from("seasons")
        .insert({ club_id: clubId, name: seasonName.trim(), status: "draft" })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
  });

  const publishMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("publish_season", { _season_id: id });
      if (error) throw error;
      // Fan out push notifications to placed players. Failure is non-blocking.
      await supabase.rpc("notify_season_published", { _season_id: id });
    },
  });

  const carryOverMut = useMutation({
    mutationFn: async ({
      targetId,
      ids,
    }: { targetId: string; ids: string[] }): Promise<number> => {
      if (!currentSeason || ids.length === 0) return 0;
      // Explicit per-player team placement — juniors usually move up a grade,
      // so we never rely on matching the old team name.
      const placed = ids
        .map((id) => ({ club_player_id: id, team_id: assignments[id] ?? null }))
        .filter((a) => !!a.team_id);
      if (placed.length === 0) return 0;
      const { data, error } = await supabase.rpc("carry_over_players_to_teams", {
        _target_season_id: targetId,
        _assignments: placed,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });

  const goNext = async () => {
    try {
      if (step === 1) {
        if (archiveCurrent && currentSeason) {
          await archiveMut.mutateAsync();
          toast.success(`${currentSeason.name} archived`);
        }
        setStep(2);
      } else if (step === 2) {
        if (!seasonName.trim()) {
          toast.error("Enter a season name");
          return;
        }
        const id = await createMut.mutateAsync();
        setCreatedSeasonId(id);
        toast.success("Draft season created");
        setStep(3);
      } else if (step === 3) {
        // Carry over selected players
        if (createdSeasonId && selectedPlayerIds.size > 0) {
          const count = await carryOverMut.mutateAsync({
            targetId: createdSeasonId,
            ids: Array.from(selectedPlayerIds),
          });
          setCarriedOverCount(count);
          if (count > 0) toast.success(`${count} player${count === 1 ? "" : "s"} carried over`);
        } else {
          setCarriedOverCount(0);
        }
        setStep(4);
      } else if (step === 4) {
        setStep(5);
      } else if (step === 5) {
        setStep(6);
      } else if (step === 6 && createdSeasonId) {
        await publishMut.mutateAsync(createdSeasonId);
        toast.success("New season is live!");
        qc.invalidateQueries({ queryKey: ["club-seasons", clubId] });
        qc.invalidateQueries({ queryKey: ["current-season", clubId] });
        onComplete();
        reset();
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const goBack = () => {
    // Once the draft season exists, steps 1-3 are no longer replayable,
    // but invite/review/publish can be revisited freely.
    const min: Step = createdSeasonId ? 4 : 1;
    if (step > min) setStep((step - 1) as Step);
  };

  const busy = archiveMut.isPending || createMut.isPending || publishMut.isPending || carryOverMut.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Start new season
          </DialogTitle>
          <DialogDescription>Step {step} of 6</DialogDescription>
        </DialogHeader>

        <Progress value={(step / 6) * 100} className="h-1" />

        <div className="py-4 space-y-4">
          {step === 1 && (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <Archive className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <h3 className="font-semibold">Archive current season</h3>
                  <p className="text-sm text-muted-foreground">
                    {currentSeason
                      ? `Sets all teams in "${currentSeason.name}" to read-only. Chats, events and history stay intact.`
                      : "No active season to archive."}
                  </p>
                </div>
              </div>
              {currentSeason && (
                <div className="flex items-center justify-between p-3 rounded-lg border">
                  <Label htmlFor="archive-toggle" className="cursor-pointer">
                    Archive {currentSeason.name}
                  </Label>
                  <Switch id="archive-toggle" checked={archiveCurrent} onCheckedChange={setArchiveCurrent} />
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="season-name">Season name</Label>
                <Input
                  id="season-name"
                  value={seasonName}
                  onChange={(e) => setSeasonName(e.target.value)}
                  placeholder="e.g. Winter 2027"
                  autoFocus
                />
              </div>
              {currentSeason && (
                <>
                  <div className="flex items-start gap-3 p-3 rounded-lg border">
                    <Checkbox
                      id="dup"
                      checked={duplicateStructure}
                      onCheckedChange={(v) => setDuplicateStructure(!!v)}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <Label htmlFor="dup" className="cursor-pointer">Duplicate structure from {currentSeason.name}</Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Copies team names. You'll choose which players to carry over next.
                      </p>
                    </div>
                  </div>
                  {duplicateStructure && (
                    <div className="flex items-start gap-3 p-3 rounded-lg border ml-6">
                      <Checkbox
                        id="staff"
                        checked={copyStaff}
                        onCheckedChange={(v) => setCopyStaff(!!v)}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <Label htmlFor="staff" className="cursor-pointer">Also copy coaches & team admins</Label>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {step === 3 && (
            currentSeason ? (
              <ReturningMembersStep
                sourceSeasonId={currentSeason.id}
                targetSeasonId={createdSeasonId}
                selectedIds={selectedPlayerIds}
                onChange={setSelectedPlayerIds}
                assignments={assignments}
                onAssignmentsChange={setAssignments}
              />
            ) : (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No previous season — skip to review.
              </p>
            )
          )}

          {step === 4 && (
            <SeasonInviteStep
              clubId={clubId}
              targetSeasonId={createdSeasonId}
              seasonName={seasonName}
            />
          )}

          {step === 5 && (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <h3 className="font-semibold">Review</h3>
                  <p className="text-sm text-muted-foreground">
                    Your new season is in <strong>draft</strong> mode. Confirm the details below.
                  </p>
                </div>
              </div>
              <div className="rounded-lg border p-3 text-sm space-y-1">
                <p><span className="text-muted-foreground">Name:</span> <strong>{seasonName}</strong></p>
                <p><span className="text-muted-foreground">Status:</span> Draft</p>
                {duplicateStructure && currentSeason && (
                  <p><span className="text-muted-foreground">Structure:</span> Cloned from {currentSeason.name}{copyStaff ? " (with staff)" : ""}</p>
                )}
                {carriedOverCount !== null && (
                  <p>
                    <span className="text-muted-foreground">Players carried over:</span>{" "}
                    <strong>{carriedOverCount}</strong>
                    {selectedPlayerIds.size > carriedOverCount && (
                      <span className="text-xs text-muted-foreground ml-1">
                        ({selectedPlayerIds.size - carriedOverCount} need manual assignment)
                      </span>
                    )}
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Tip: You can adjust team rosters from each team page after publishing.
              </p>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <Rocket className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <h3 className="font-semibold">Publish {seasonName}?</h3>
                  <p className="text-sm text-muted-foreground">
                    This makes the new season active across the club. Members will see the new teams immediately.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="ghost" onClick={goBack} disabled={busy || step === (createdSeasonId ? 4 : 1)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button onClick={goNext} disabled={busy}>
            {step === 6 ? <><Rocket className="h-4 w-4 mr-1" /> Publish</> : <>Next <ArrowRight className="h-4 w-4 ml-1" /></>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
