import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { MobileSelect } from "@/components/ui/mobile-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface AdminManualEnrolDialogProps {
  clubId: string;
  termId: string;
  classes: Array<{
    id: string;
    name: string;
    class_capacity: number | null;
    team_type: string;
  }>;
  enrolmentCounts: Record<string, number>;
}

export function AdminManualEnrolDialog({
  clubId,
  termId,
  classes,
  enrolmentCounts,
}: AdminManualEnrolDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [enrolmentType, setEnrolmentType] = useState<"child" | "adult">("child");
  const [searchQuery, setSearchQuery] = useState("");

  const selectedClass = classes.find((c) => c.id === selectedClassId);
  const allowsChildren = selectedClass?.team_type === "junior" || selectedClass?.team_type === "mixed";
  const allowsAdults = selectedClass?.team_type === "senior" || selectedClass?.team_type === "mixed";

  // Search children by name
  const { data: childResults = [] } = useQuery({
    queryKey: ["admin-search-children", clubId, searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];
      const { data, error } = await supabase
        .from("children")
        .select("id, name, parent_id")
        .ilike("name", `%${searchQuery}%`)
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: enrolmentType === "child" && searchQuery.length >= 2,
  });

  // Search adult profiles
  const { data: adultResults = [] } = useQuery({
    queryKey: ["admin-search-adults", searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name")
        .ilike("display_name", `%${searchQuery}%`)
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: enrolmentType === "adult" && searchQuery.length >= 2,
  });

  const enrolMutation = useMutation({
    mutationFn: async ({
      childId,
      userId,
    }: {
      childId?: string;
      userId?: string;
    }) => {
      if (!selectedClassId || !termId) throw new Error("Missing data");

      const currentCount = enrolmentCounts[selectedClassId] || 0;
      const isFull =
        selectedClass?.class_capacity &&
        currentCount >= selectedClass.class_capacity;
      const status = isFull ? "waitlisted" : "enrolled";

      let waitlistPosition: number | null = null;
      if (status === "waitlisted") {
        const { count } = await supabase
          .from("class_enrolments")
          .select("*", { count: "exact", head: true })
          .eq("term_id", termId)
          .eq("team_id", selectedClassId)
          .eq("status", "waitlisted");
        waitlistPosition = (count || 0) + 1;
      }

      const record: any = {
        team_id: selectedClassId,
        term_id: termId,
        status,
        waitlist_position: waitlistPosition,
      };
      if (childId) record.child_id = childId;
      if (userId) record.user_id = userId;

      const { error } = await supabase
        .from("class_enrolments")
        .insert(record);
      if (error) throw error;
      return { status };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-enrolments"] });
      queryClient.invalidateQueries({ queryKey: ["class-enrolment-counts"] });
      setSearchQuery("");
      toast({
        title:
          result.status === "enrolled"
            ? "Enrolled successfully"
            : "Added to waitlist",
      });
    },
    onError: (error: any) => {
      const isDuplicate =
        error?.code === "23505" || error?.message?.includes("duplicate");
      toast({
        title: isDuplicate ? "Already enrolled" : "Enrolment failed",
        description: isDuplicate
          ? "This member is already enrolled in this class."
          : "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Auto-set enrolment type based on class
  const handleClassChange = (classId: string) => {
    setSelectedClassId(classId);
    setSearchQuery("");
    const cls = classes.find((c) => c.id === classId);
    if (cls?.team_type === "junior") setEnrolmentType("child");
    else if (cls?.team_type === "senior") setEnrolmentType("adult");
  };

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <UserPlus className="h-3.5 w-3.5" />
        Manual Enrol
      </Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Manual Enrolment</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-4 px-1 pt-2">
            <div className="space-y-2">
              <Label className="text-base">Class</Label>
              <MobileSelect
                value={selectedClassId}
                onValueChange={handleClassChange}
                options={classes.map((cls) => ({ value: cls.id, label: cls.name }))}
                placeholder="Select a class"
                title="Select Class"
              />
            </div>

            {selectedClassId && (allowsChildren && allowsAdults) && (
              <div className="space-y-2">
                <Label className="text-base">Enrolment Type</Label>
                <div className="flex gap-2">
                  <Button
                    variant={enrolmentType === "child" ? "default" : "outline"}
                    size="sm"
                    className="h-10"
                    onClick={() => {
                      setEnrolmentType("child");
                      setSearchQuery("");
                    }}
                  >
                    Child
                  </Button>
                  <Button
                    variant={enrolmentType === "adult" ? "default" : "outline"}
                    size="sm"
                    className="h-10"
                    onClick={() => {
                      setEnrolmentType("adult");
                      setSearchQuery("");
                    }}
                  >
                    Adult
                  </Button>
                </div>
              </div>
            )}

            {selectedClassId && (
              <div className="space-y-2">
                <Label className="text-base">
                  Search {enrolmentType === "child" ? "Child" : "Member"} by Name
                </Label>
                <Input
                  placeholder={`Type a name...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-12 text-base"
                />
                {searchQuery.length >= 2 && (
                  <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-1">
                    {enrolmentType === "child"
                      ? childResults.length === 0 ? (
                          <p className="text-xs text-muted-foreground p-2">
                            No children found
                          </p>
                        ) : (
                          childResults.map((child) => (
                            <button
                              key={child.id}
                              className="w-full text-left px-3 py-3 text-sm rounded hover:bg-muted flex items-center justify-between"
                              onClick={() =>
                                enrolMutation.mutate({ childId: child.id })
                              }
                              disabled={enrolMutation.isPending}
                            >
                              <span>{child.name}</span>
                              {enrolMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Badge variant="outline" className="text-[10px]">
                                  Enrol
                                </Badge>
                              )}
                            </button>
                          ))
                        )
                      : adultResults.length === 0 ? (
                          <p className="text-xs text-muted-foreground p-2">
                            No members found
                          </p>
                        ) : (
                          adultResults.map((profile) => (
                            <button
                              key={profile.id}
                              className="w-full text-left px-3 py-3 text-sm rounded hover:bg-muted flex items-center justify-between"
                              onClick={() =>
                                enrolMutation.mutate({ userId: profile.id })
                              }
                              disabled={enrolMutation.isPending}
                            >
                              <span>{profile.display_name || "Unknown"}</span>
                              {enrolMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Badge variant="outline" className="text-[10px]">
                                  Enrol
                                </Badge>
                              )}
                            </button>
                          ))
                        )}
                  </div>
                )}
              </div>
            )}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
