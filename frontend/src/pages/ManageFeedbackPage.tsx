import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Trash2, MessageSquare, Bug, Lightbulb, HelpCircle, Circle, Clock, CheckCircle2, Filter } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

type FeedbackStatus = "open" | "in_progress" | "resolved";

const statusConfig: Record<FeedbackStatus, { label: string; icon: typeof Circle; className: string }> = {
  open: { label: "Open", icon: Circle, className: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" },
  in_progress: { label: "In Progress", icon: Clock, className: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  resolved: { label: "Resolved", icon: CheckCircle2, className: "bg-green-500/10 text-green-500 border-green-500/20" },
};

const typeIcons = {
  feature_request: Lightbulb,
  bug: Bug,
  other: HelpCircle,
};

const typeLabels = {
  feature_request: "Feature Request",
  bug: "Bug Report",
  other: "Other",
};

const typeColors = {
  feature_request: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  bug: "bg-red-500/10 text-red-500 border-red-500/20",
  other: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

type StatusFilter = "all" | FeedbackStatus;

import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveFeedback, updateLiveFeedbackStatus } from "@/live/features/insights";

export default function ManageFeedbackPage() {
  return <SupabaseManageFeedbackPage />;
}

/** Maps a canister FeedbackStatus variant to the Supabase status string used by the UI. */
function fromLiveFeedbackStatus(status: { Open: null } | { InProgress: null } | { Resolved: null }): FeedbackStatus {
  if ("Open" in status) return "open";
  if ("InProgress" in status) return "in_progress";
  return "resolved";
}

function toLiveFeedbackStatus(status: FeedbackStatus): "Open" | "InProgress" | "Resolved" {
  if (status === "open") return "Open";
  if (status === "in_progress") return "InProgress";
  return "Resolved";
}

function SupabaseManageFeedbackPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Shared hook routes the check to insights_domain in ICP mode — an
  // Internet Identity app admin has no Supabase session for user_roles.
  const { isAppAdmin } = useIsAppAdmin();

  const { data: feedback, isLoading } = useQuery({
    queryKey: ["all-feedback"],
    queryFn: async () => {
      return withFeatureBackend("admin", {
        supabase: async () => {
          const { data, error } = await supabase
            .from("feedback")
            .select("*, profiles:user_id(display_name, avatar_url)")
            .order("created_at", { ascending: false });
          if (error) throw error;
          return data;
        },
        icp: async (ctx) => {
          // Provisional mapping: canister has no profile join, so `profiles`
          // falls back to the caller's principal text for display.
          const { items } = await listLiveFeedback(ctx, null, 0, 200);
          return items.map((item) => ({
            id: item.id,
            type: item.kind,
            title: item.title[0] ?? item.message,
            description: item.title.length ? item.message : null,
            status: fromLiveFeedbackStatus(item.status),
            created_at: new Date(Number(item.created_at_ms)).toISOString(),
            profiles: { display_name: item.user.toText(), avatar_url: null },
          }));
        },
      });
    },
    enabled: isAppAdmin === true,
  });

  const filteredFeedback = useMemo(() => {
    if (!feedback) return [];
    if (statusFilter === "all") return feedback;
    return feedback.filter((item) => item.status === statusFilter);
  }, [feedback, statusFilter]);

  const deleteFeedbackMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("feedback").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-feedback"] });
      toast({ title: "Feedback deleted" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: FeedbackStatus }) => {
      await withFeatureBackend("admin", {
        supabase: async () => {
          const { error } = await supabase.from("feedback").update({ status }).eq("id", id);
          if (error) throw error;
        },
        icp: async (ctx) => {
          await updateLiveFeedbackStatus(ctx, id, toLiveFeedbackStatus(status), null);
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-feedback"] });
      toast({ title: "Status updated" });
    },
  });

  if (!isAppAdmin) {
    return (
      <div className="py-6 text-center">
        <p className="text-muted-foreground">Access denied. App admin only.</p>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Feedback</h1>
          <p className="text-sm text-muted-foreground">View and manage user feedback submissions</p>
        </div>
        <MessageSquare className="h-6 w-6 text-primary" />
      </div>

      {/* Feedback List */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-lg font-semibold">
            {statusFilter === "all" ? "All" : statusConfig[statusFilter].label} Submissions ({filteredFeedback.length})
          </h2>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <div className="flex gap-1">
              <Button
                variant={statusFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("all")}
                className="h-7 text-xs"
              >
                All
              </Button>
              <Button
                variant={statusFilter === "open" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("open")}
                className="h-7 text-xs"
              >
                <Circle className="h-3 w-3 mr-1" />
                Open
              </Button>
              <Button
                variant={statusFilter === "in_progress" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("in_progress")}
                className="h-7 text-xs"
              >
                <Clock className="h-3 w-3 mr-1" />
                In Progress
              </Button>
              <Button
                variant={statusFilter === "resolved" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("resolved")}
                className="h-7 text-xs"
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Resolved
              </Button>
            </div>
          </div>
        </div>
        
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : filteredFeedback.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              {statusFilter === "all" ? "No feedback submissions yet." : `No ${statusConfig[statusFilter].label.toLowerCase()} feedback.`}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredFeedback.map((item) => {
              const TypeIcon = typeIcons[item.type as keyof typeof typeIcons] || HelpCircle;
              const typeLabel = typeLabels[item.type as keyof typeof typeLabels] || item.type;
              const colorClass = typeColors[item.type as keyof typeof typeColors] || typeColors.other;
              const status = (item.status as FeedbackStatus) || "open";
              const StatusIcon = statusConfig[status].icon;
              
              return (
                <Card key={item.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${colorClass.split(" ")[0]}`}>
                        <TypeIcon className={`h-5 w-5 ${colorClass.split(" ")[1]}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge variant="outline" className={colorClass}>
                            {typeLabel}
                          </Badge>
                          <Badge variant="outline" className={statusConfig[status].className}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {statusConfig[status].label}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {format(parseISO(item.created_at), "MMM d, yyyy 'at' h:mm a")}
                          </span>
                        </div>
                        <h3 className="font-semibold">{item.title}</h3>
                        {item.description && (
                          <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                            {item.description}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                          From: {item.profiles?.display_name || "Unknown User"}
                        </p>
                        
                        <div className="mt-3">
                          <Select
                            value={status}
                            onValueChange={(value: FeedbackStatus) => 
                              updateStatusMutation.mutate({ id: item.id, status: value })
                            }
                          >
                            <SelectTrigger className="w-[140px] h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">
                                <span className="flex items-center gap-1.5">
                                  <Circle className="h-3 w-3 text-yellow-500" />
                                  Open
                                </span>
                              </SelectItem>
                              <SelectItem value="in_progress">
                                <span className="flex items-center gap-1.5">
                                  <Clock className="h-3 w-3 text-blue-500" />
                                  In Progress
                                </span>
                              </SelectItem>
                              <SelectItem value="resolved">
                                <span className="flex items-center gap-1.5">
                                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                                  Resolved
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-destructive shrink-0">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Feedback?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete this feedback submission.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction 
                              onClick={() => deleteFeedbackMutation.mutate(item.id)}
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
      </section>
    </div>
  );
}
