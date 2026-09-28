import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserMinus, Clock, CalendarDays, Download } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MobileSelect } from "@/components/ui/mobile-select";
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
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useToast } from "@/hooks/use-toast";
import { AdminManualEnrolDialog } from "@/components/AdminManualEnrolDialog";
import { exportEnrolmentsCSV } from "@/lib/exportEnrolments";

interface AdminEnrolmentManagerProps {
  clubId: string;
}

export function AdminEnrolmentManager({ clubId }: AdminEnrolmentManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTermId, setSelectedTermId] = useState<string>("");
  const [dayFilter, setDayFilter] = useState<string>("all");

  // Fetch active terms
  const { data: terms = [] } = useQuery({
    queryKey: ["terms", clubId, "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("terms")
        .select("*")
        .eq("club_id", clubId)
        .eq("is_active", true)
        .order("start_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const termId = selectedTermId || terms[0]?.id;
  const activeTerm = terms.find((t) => t.id === termId) || terms[0];

  // Fetch classes for this club
  const { data: classes = [] } = useQuery({
    queryKey: ["club-classes", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, class_day, class_time, class_capacity, level_age, team_type")
        .eq("club_id", clubId)
        .eq("is_archived", false)
        .not("class_day", "is", null)
        .order("class_day")
        .order("class_time");
      if (error) throw error;
      return data;
    },
  });

  // Fetch all enrolments for the selected term with child names and user profiles
  const { data: enrolments = [], isLoading } = useQuery({
    queryKey: ["admin-enrolments", termId],
    queryFn: async () => {
      if (!termId) return [];
      const { data, error } = await supabase
        .from("class_enrolments")
        .select("*, children (name, parent_id)")
        .eq("term_id", termId)
        .neq("status", "withdrawn")
        .order("created_at", { ascending: true });
      if (error) throw error;

      // Fetch display names for adult enrolments separately
      const adultUserIds = data
        ?.filter((e: any) => e.user_id && !e.child_id)
        .map((e: any) => e.user_id) || [];

      let profileMap: Record<string, string> = {};
      if (adultUserIds.length > 0) {
        const { data: profiles } = await selectCachedProfilesByIds(adultUserIds);
        profiles?.forEach((p) => {
          if (p.display_name) profileMap[p.id] = p.display_name;
        });
      }

      return data.map((e: any) => ({
        ...e,
        _adult_name: e.user_id ? profileMap[e.user_id] || null : null,
      }));
    },
    enabled: !!termId,
  });

  // Enrolment counts for manual enrol dialog
  const enrolmentCounts: Record<string, number> = {};
  enrolments.forEach((e: any) => {
    if (e.status === "enrolled") {
      enrolmentCounts[e.team_id] = (enrolmentCounts[e.team_id] || 0) + 1;
    }
  });

  // Withdraw mutation
  const withdrawMutation = useMutation({
    mutationFn: async (enrolmentId: string) => {
      const { error } = await supabase
        .from("class_enrolments")
        .update({ status: "withdrawn", withdrawn_at: new Date().toISOString() })
        .eq("id", enrolmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-enrolments"] });
      toast({ title: "Member withdrawn" });
    },
  });

  // Helper to get display name from an enrolment
  const getEnrolmentName = (enrolment: any): string => {
    if (enrolment.child_id && enrolment.children?.name) {
      return enrolment.children.name;
    }
    if (enrolment.user_id && enrolment._adult_name) {
      return enrolment._adult_name;
    }
    return "Unknown";
  };

  // Helper to get enrolment type label
  const getEnrolmentTypeLabel = (enrolment: any): string | null => {
    if (enrolment.child_id) return "Child";
    if (enrolment.user_id) return "Adult";
    return null;
  };

  const handleExportCSV = () => {
    if (!activeTerm) return;
    const rows = enrolments.map((e: any) => {
      const cls = classes.find((c) => c.id === e.team_id);
      return {
        className: cls?.name || "Unknown",
        memberName: getEnrolmentName(e),
        type: getEnrolmentTypeLabel(e) || "Unknown",
        status: e.status,
        waitlistPosition: e.waitlist_position,
        enrolledDate: format(new Date(e.enrolled_at || e.created_at), "dd/MM/yyyy"),
      };
    });
    exportEnrolmentsCSV(rows, activeTerm.name);
    toast({ title: "CSV exported" });
  };

  if (terms.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        Create an active term to manage enrolments.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {enrolments.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleExportCSV}
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
        )}
        {termId && (
          <AdminManualEnrolDialog
            clubId={clubId}
            termId={termId}
            classes={classes.map((c) => ({
              id: c.id,
              name: c.name,
              class_capacity: c.class_capacity,
              team_type: c.team_type || "mixed",
            }))}
            enrolmentCounts={enrolmentCounts}
          />
        )}
      </div>

      {terms.length > 1 ? (
        <MobileSelect
          value={termId || ""}
          onValueChange={setSelectedTermId}
          options={terms.map((term) => ({ value: term.id, label: term.name }))}
          placeholder="Select a term"
          title="Select Term"
        />
      ) : terms.length === 1 ? (
        <p className="text-sm text-muted-foreground">{terms[0].name}</p>
      ) : null}

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : classes.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No classes set up yet.</p>
      ) : (
        <div className="space-y-4">
          {/* Day filter chips */}
          {(() => {
            const uniqueDays = [...new Set(classes.map(c => (c as any).class_day).filter(Boolean))];
            if (uniqueDays.length > 1) {
              return (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  <Button
                    variant={dayFilter === "all" ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs shrink-0"
                    onClick={() => setDayFilter("all")}
                  >
                    All Days
                  </Button>
                  {uniqueDays.map(day => (
                    <Button
                      key={day}
                      variant={dayFilter === day ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs shrink-0"
                      onClick={() => setDayFilter(day!)}
                    >
                      {day}
                    </Button>
                  ))}
                </div>
              );
            }
            return null;
          })()}
          {classes.filter(cls => dayFilter === "all" || (cls as any).class_day === dayFilter).map((cls) => {
            const classEnrolments = enrolments.filter((e) => e.team_id === cls.id);
            const enrolled = classEnrolments.filter((e) => e.status === "enrolled");
            const waitlisted = classEnrolments.filter((e) => e.status === "waitlisted");

            return (
              <Card key={cls.id}>
                <CardContent className="py-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{cls.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {cls.class_day && (
                          <span className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {cls.class_day}
                          </span>
                        )}
                        {cls.class_time && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {cls.class_time.slice(0, 5)}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {enrolled.length}{cls.class_capacity ? `/${cls.class_capacity}` : ""} enrolled
                    </Badge>
                  </div>

                  {enrolled.length === 0 && waitlisted.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No enrolments yet</p>
                  ) : (
                    <div className="space-y-1">
                      {enrolled.map((e) => {
                        const name = getEnrolmentName(e);
                        const typeLabel = getEnrolmentTypeLabel(e);
                        return (
                          <div key={e.id} className="flex items-center justify-between text-sm py-1 px-2 rounded bg-muted/50">
                            <div className="flex items-center gap-2">
                              <span>{name}</span>
                              {typeLabel && (
                                <span className="text-[10px] text-muted-foreground">({typeLabel})</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="default" className="text-[10px] h-5">Enrolled</Badge>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive">
                                    <UserMinus className="h-3 w-3" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Withdraw member?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will remove {name} from {cls.name}. The next waitlisted member will be automatically promoted.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => withdrawMutation.mutate(e.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Withdraw
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        );
                      })}
                      {waitlisted.map((e) => {
                        const name = getEnrolmentName(e);
                        const typeLabel = getEnrolmentTypeLabel(e);
                        return (
                          <div key={e.id} className="flex items-center justify-between text-sm py-1 px-2 rounded bg-muted/30">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">{name}</span>
                              {typeLabel && (
                                <span className="text-[10px] text-muted-foreground">({typeLabel})</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-[10px] h-5">
                                Waitlist #{e.waitlist_position}
                              </Badge>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive">
                                    <UserMinus className="h-3 w-3" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Remove from waitlist?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will remove {name} from the waitlist for {cls.name}.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => withdrawMutation.mutate(e.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Remove
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
