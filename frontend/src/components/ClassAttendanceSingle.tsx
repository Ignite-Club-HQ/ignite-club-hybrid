import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Check, X, Clock } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface ClassAttendanceSingleProps {
  teamId: string;
  clubId: string;
}

type AttendanceStatus = "present" | "absent" | "late";

export function ClassAttendanceSingle({ teamId, clubId }: ClassAttendanceSingleProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sessionDate, setSessionDate] = useState<string>(
    format(new Date(), "yyyy-MM-dd")
  );
  const [selectedTermId, setSelectedTermId] = useState<string>("");

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

  const { data: enrolledMembers = [] } = useQuery({
    queryKey: ["class-enrolled", termId, teamId],
    queryFn: async () => {
      if (!termId) return [];
      const { data, error } = await supabase
        .from("class_enrolments")
        .select("*, children (id, name)")
        .eq("term_id", termId)
        .eq("team_id", teamId)
        .eq("status", "enrolled")
        .order("created_at");
      if (error) throw error;

      const adultIds = data?.filter((e: any) => e.user_id && !e.child_id).map((e: any) => e.user_id) || [];
      let profileMap: Record<string, string> = {};
      if (adultIds.length > 0) {
        const { data: profiles } = await selectCachedProfilesByIds(adultIds);
        profiles?.forEach((p) => {
          if (p.display_name) profileMap[p.id] = p.display_name;
        });
      }

      return data.map((e: any) => ({
        ...e,
        _name: e.child_id ? e.children?.name || "Unknown" : profileMap[e.user_id] || "Unknown",
      }));
    },
    enabled: !!termId,
  });

  const { data: attendance = [], isLoading } = useQuery({
    queryKey: ["class-attendance", termId, teamId, sessionDate],
    queryFn: async () => {
      if (!termId || !sessionDate) return [];
      const { data, error } = await supabase
        .from("class_attendance")
        .select("*")
        .eq("term_id", termId)
        .eq("team_id", teamId)
        .eq("session_date", sessionDate);
      if (error) throw error;
      return data;
    },
    enabled: !!termId && !!sessionDate,
  });

  const getStatus = (childId: string | null, userId: string | null): AttendanceStatus | null => {
    const record = attendance.find(
      (a: any) => (childId && a.child_id === childId) || (userId && !childId && a.user_id === userId)
    );
    return (record as any)?.status || null;
  };

  const markMutation = useMutation({
    mutationFn: async ({ childId, userId, status }: { childId: string | null; userId: string | null; status: AttendanceStatus }) => {
      if (!termId || !sessionDate) throw new Error("Missing data");
      const record: any = { term_id: termId, team_id: teamId, session_date: sessionDate, status, marked_by: user?.id };
      if (childId) record.child_id = childId;
      if (userId) record.user_id = userId;

      const { error } = await supabase.from("class_attendance").upsert(record, {
        onConflict: childId ? "term_id,team_id,session_date,child_id" : "term_id,team_id,session_date,user_id",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["class-attendance", termId, teamId, sessionDate] });
    },
    onError: () => {
      toast({ title: "Failed to update attendance", variant: "destructive" });
    },
  });

  if (terms.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">No active terms.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        {terms.length > 1 && (
          <Select value={termId || ""} onValueChange={setSelectedTermId}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Term" />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              {terms.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <input
          type="date"
          value={sessionDate}
          onChange={(e) => setSessionDate(e.target.value)}
          className="h-9 px-3 rounded-md border border-input bg-background text-sm w-full sm:w-auto"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : enrolledMembers.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4 italic">No enrolled members</p>
      ) : (
        <Card>
          <CardContent className="py-2 divide-y">
            {enrolledMembers.map((member: any) => {
              const currentStatus = getStatus(member.child_id, member.user_id);
              return (
                <div key={member.id} className="flex items-center justify-between py-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {currentStatus === "present" && <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                    {currentStatus === "absent" && <X className="h-3.5 w-3.5 text-destructive shrink-0" />}
                    {currentStatus === "late" && <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                    <span className="text-sm truncate">{member._name}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {(["present", "late", "absent"] as AttendanceStatus[]).map((s) => (
                      <Button
                        key={s}
                        variant={currentStatus === s ? "default" : "outline"}
                        size="sm"
                        className={`h-6 text-[10px] px-1.5 ${
                          currentStatus === s
                            ? s === "present"
                              ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                              : s === "late"
                              ? "bg-amber-500 hover:bg-amber-600 text-white"
                              : "bg-destructive hover:bg-destructive/90"
                            : ""
                        }`}
                        onClick={() =>
                          markMutation.mutate({
                            childId: member.child_id,
                            userId: member.child_id ? null : member.user_id,
                            status: s,
                          })
                        }
                        disabled={markMutation.isPending}
                      >
                        {s === "present" ? "P" : s === "late" ? "L" : "A"}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {enrolledMembers.length > 0 && (
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Check className="h-3 w-3 text-emerald-500" />{attendance.filter((a: any) => a.status === "present").length}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-amber-500" />{attendance.filter((a: any) => a.status === "late").length}
          </span>
          <span className="flex items-center gap-1">
            <X className="h-3 w-3 text-destructive" />{attendance.filter((a: any) => a.status === "absent").length}
          </span>
        </div>
      )}
    </div>
  );
}
