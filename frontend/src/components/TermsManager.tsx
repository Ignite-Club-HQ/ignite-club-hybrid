import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarIcon, Plus, Pencil, Trash2, Loader2, CalendarDays, ToggleLeft, ToggleRight, Archive, ArchiveRestore, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface TermsManagerProps {
  clubId: string;
}

export function TermsManager({ clubId }: TermsManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState<any>(null);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();

  const { data: terms = [], isLoading } = useQuery({
    queryKey: ["terms", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("terms")
        .select("*")
        .eq("club_id", clubId)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim() || !startDate || !endDate) throw new Error("Missing fields");

      if (endDate <= startDate) {
        throw new Error("End date must be after start date");
      }

      // Check for overlapping terms
      const overlapping = terms.find((t) => {
        if (editingTerm && t.id === editingTerm.id) return false;
        const tStart = new Date(t.start_date);
        const tEnd = new Date(t.end_date);
        return startDate <= tEnd && endDate >= tStart;
      });
      if (overlapping) {
        throw new Error(`Dates overlap with "${overlapping.name}"`);
      }

      const payload = {
        club_id: clubId,
        name: name.trim(),
        start_date: format(startDate, "yyyy-MM-dd"),
        end_date: format(endDate, "yyyy-MM-dd"),
      };

      if (editingTerm) {
        const { error } = await supabase
          .from("terms")
          .update(payload)
          .eq("id", editingTerm.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("terms")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["terms", clubId] });
      closeDialog();
      toast({ title: editingTerm ? "Term updated" : "Term created" });
    },
    onError: (error: any) => {
      toast({ title: error?.message || "Failed to save term", variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("terms")
        .update({ is_active: isActive, status: isActive ? "active" : "archived" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["terms", clubId] });
    },
  });

  const setTermStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const isActive = status === "active";
      const { error } = await supabase
        .from("terms")
        .update({ status, is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["terms", clubId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("terms").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["terms", clubId] });
      toast({ title: "Term deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete term", variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditingTerm(null);
    setName("");
    setStartDate(undefined);
    setEndDate(undefined);
    setDialogOpen(true);
  };

  const openEdit = (term: any) => {
    setEditingTerm(term);
    setName(term.name);
    setStartDate(new Date(term.start_date));
    setEndDate(new Date(term.end_date));
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingTerm(null);
    setName("");
    setStartDate(undefined);
    setEndDate(undefined);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Add Term
        </Button>
      </div>

      {terms.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <CalendarDays className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No terms yet. Create a term to start scheduling classes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {terms.map((term) => (
            <Card key={term.id}>
              <CardContent className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate">{term.name}</p>
                    <Badge
                      variant={(term as any).status === "completed" ? "outline" : term.is_active ? "default" : "secondary"}
                      className={`text-xs shrink-0 ${(term as any).status === "completed" ? "border-emerald-500 text-emerald-600" : ""}`}
                    >
                      {(term as any).status === "completed" ? "Completed" : term.is_active ? "Active" : "Archived"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(term.start_date), "d MMM yyyy")} — {format(new Date(term.end_date), "d MMM yyyy")}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Status actions as a single dropdown for clarity */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {(term as any).status !== "completed" && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                              {term.is_active ? (
                                <><ToggleLeft className="h-4 w-4 mr-2 text-muted-foreground" />Archive</>
                              ) : (
                                <><ToggleRight className="h-4 w-4 mr-2 text-primary" />Activate</>
                              )}
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{term.is_active ? "Archive" : "Activate"} "{term.name}"?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {term.is_active
                                  ? "Archiving this term will hide it from enrolment. You can reactivate it later."
                                  : "Activating this term will make it available for enrolment."}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => toggleActiveMutation.mutate({ id: term.id, isActive: !term.is_active })}>
                                {term.is_active ? "Archive" : "Activate"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                            {(term as any).status === "completed" ? (
                              <><ArchiveRestore className="h-4 w-4 mr-2 text-emerald-500" />Re-open</>
                            ) : (
                              <><Archive className="h-4 w-4 mr-2" />Mark Complete</>
                            )}
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {(term as any).status === "completed" ? "Re-open" : "Complete"} "{term.name}"?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {(term as any).status === "completed"
                                ? "This will re-open the term and set it back to active."
                                : "Marking this term as completed indicates it has finished. You can re-open it later if needed."}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() =>
                                setTermStatusMutation.mutate({
                                  id: term.id,
                                  status: (term as any).status === "completed" ? "active" : "completed",
                                })
                              }
                            >
                              {(term as any).status === "completed" ? "Re-open" : "Complete"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={(e) => { e.preventDefault(); openEdit(term); }}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive focus:text-destructive">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete "{term.name}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will remove the term and all associated enrolments. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(term.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <ResponsiveDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{editingTerm ? "Edit Term" : "Create Term"}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-4 py-2 px-1">
            <div className="space-y-2">
              <Label>Term Name</Label>
              <Input
                placeholder="e.g., Term 1 2026"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                className="h-11"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal h-11", !startDate && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {startDate ? format(startDate, "d MMM yy") : "Pick date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal h-11", !endDate && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {endDate ? format(endDate, "d MMM yy") : "Pick date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={setEndDate}
                      disabled={(date) => startDate ? date < startDate : false}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
          <ResponsiveDialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              className="w-full sm:w-auto h-12 text-base"
              onClick={() => saveMutation.mutate()}
              disabled={!name.trim() || !startDate || !endDate || saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editingTerm ? "Save" : "Create"}
            </Button>
            <Button variant="outline" className="w-full sm:w-auto h-12 text-base" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
