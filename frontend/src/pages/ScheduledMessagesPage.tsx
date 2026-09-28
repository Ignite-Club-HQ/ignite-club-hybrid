import { Suspense, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { format, formatDistanceToNow, isToday, isTomorrow } from "date-fns";
import {
  ArrowLeft,
  Clock,
  Pencil,
  X,
  AlertCircle,
  Image as ImageIcon,
  Repeat,
  CheckCircle2,
  Users,
  Hash,
  User as UserIcon,
  Megaphone,
  Shield,
  ChevronRight,
  Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import {
  ScheduledMessageRow,
  useAllScheduledMessages,
  useCancelScheduledMessage,
} from "@/hooks/useScheduledMessages";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { useUserHasAnyClubPro } from "@/hooks/useUserHasAnyClubPro";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { useClubTheme } from "@/hooks/useClubTheme";

interface ThreadInfo {
  label: string;
  sublabel?: string;
  href?: string;
}

const ScheduleMessageDialog = lazyWithRetry(() =>
  import("@/components/chat/ScheduleMessageDialog").then(module => ({
    default: module.ScheduleMessageDialog,
  })),
);

function rowTarget(row: ScheduledMessageRow) {
  return {
    chat_type: row.chat_type,
    team_id: row.team_id,
    club_id: row.club_id,
    group_id: row.group_id,
    conversation_id: row.conversation_id,
  };
}

function dateGroupLabel(d: Date): string {
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "EEEE, MMM d");
}

function chatTypeIcon(type: ScheduledMessageRow["chat_type"]) {
  switch (type) {
    case "team":
      return Users;
    case "club":
      return Shield;
    case "group":
      return Hash;
    case "direct":
      return UserIcon;
    case "club_admin":
      return Shield;
    case "broadcast":
      return Megaphone;
    default:
      return Clock;
  }
}

/**
 * Resolve human-readable thread labels for a list of scheduled rows.
 * Batches one query per table to avoid N+1.
 */
function useThreadLabels(rows: ScheduledMessageRow[]) {
  const teamIds = [...new Set(rows.filter((r) => r.team_id).map((r) => r.team_id!))];
  const clubIds = [...new Set(rows.filter((r) => r.club_id).map((r) => r.club_id!))];
  const groupIds = [...new Set(rows.filter((r) => r.group_id).map((r) => r.group_id!))];
  const dmConvIds = [
    ...new Set(
      rows
        .filter((r) => r.chat_type === "direct" && r.conversation_id)
        .map((r) => r.conversation_id!),
    ),
  ];
  const adminConvIds = [
    ...new Set(
      rows
        .filter((r) => r.chat_type === "club_admin" && r.conversation_id)
        .map((r) => r.conversation_id!),
    ),
  ];

  const key = [
    teamIds.join(","),
    clubIds.join(","),
    groupIds.join(","),
    dmConvIds.join(","),
    adminConvIds.join(","),
  ].join("|");

  return useQuery({
    queryKey: ["scheduled-message-thread-labels", key],
    queryFn: async () => {
      const labels: Record<string, ThreadInfo> = {};
      const tasks: Promise<void>[] = [];

      if (teamIds.length > 0) {
        tasks.push((async () => {
          const { data } = await supabase
            .from("teams")
            .select("id, name, clubs!club_id(name)")
            .in("id", teamIds)
            .is("deleted_at", null);
          (data || []).forEach((t: any) => {
            labels[`team:${t.id}`] = {
              label: `${t.name} chat`,
              sublabel: t.clubs?.name,
              href: `/teams/${t.id}/chat`,
            };
          });
        })());
      }
      if (clubIds.length > 0) {
        tasks.push((async () => {
          const { data } = await supabase.from("clubs").select("id, name").in("id", clubIds);
          (data || []).forEach((c: any) => {
            labels[`club:${c.id}`] = {
              label: `${c.name} club chat`,
              href: `/clubs/${c.id}/chat`,
            };
          });
        })());
      }
      if (groupIds.length > 0) {
        tasks.push((async () => {
          const { data } = await supabase
            .from("chat_groups")
            .select("id, name")
            .in("id", groupIds);
          (data || []).forEach((g: any) => {
            labels[`group:${g.id}`] = {
              label: g.name,
              sublabel: "Group chat",
              href: `/groups/${g.id}/chat`,
            };
          });
        })());
      }
      if (dmConvIds.length > 0) {
        tasks.push((async () => {
          const { data } = await supabase
            .from("direct_conversations")
            .select("id, participant_1, participant_2")
            .in("id", dmConvIds);
          const convs = data || [];
          const userIds = Array.from(
            new Set<string>(
              convs.flatMap((conversation: any) =>
                [conversation.participant_1, conversation.participant_2].filter(
                  (id): id is string => typeof id === "string",
                ),
              ),
            ),
          );
          const { data: profiles } = await selectCachedProfilesByIds(userIds);
          const profMap: Record<string, string> = {};
          (profiles || []).forEach((p: any) => {
            profMap[p.id] = p.display_name || "Unknown";
          });
          const me = (await supabase.auth.getUser()).data.user?.id;
          convs.forEach((c: any) => {
            const otherId = c.participant_1 === me ? c.participant_2 : c.participant_1;
            labels[`direct:${c.id}`] = {
              label: profMap[otherId] || "Direct message",
              sublabel: "Direct message",
              href: `/messages/dm/${c.id}`,
            };
          });
        })());
      }
      if (adminConvIds.length > 0) {
        tasks.push((async () => {
          const { data } = await supabase
            .from("club_admin_conversations")
            .select("id, club_id, clubs!club_id(name)")
            .in("id", adminConvIds);
          (data || []).forEach((c: any) => {
            labels[`club_admin:${c.id}`] = {
              label: `${c.clubs?.name || "Club"} admin`,
              sublabel: "Club admin chat",
            };
          });
        })());
      }

      await Promise.all(tasks);
      return labels;
    },
    enabled: rows.length > 0,
    staleTime: 60 * 1000,
  });
}

function lookupLabel(
  row: ScheduledMessageRow,
  labels: Record<string, ThreadInfo>,
): ThreadInfo {
  switch (row.chat_type) {
    case "team":
      return labels[`team:${row.team_id}`] || { label: "Team chat" };
    case "club":
      return labels[`club:${row.club_id}`] || { label: "Club chat" };
    case "group":
      return labels[`group:${row.group_id}`] || { label: "Group chat" };
    case "direct":
      return labels[`direct:${row.conversation_id}`] || { label: "Direct message" };
    case "club_admin":
      return labels[`club_admin:${row.conversation_id}`] || { label: "Club admin chat" };
    case "broadcast":
      return { label: "App broadcast", sublabel: "Sent to all users" };
  }
}

import { IcpUnavailablePage } from "@/components/IcpUnavailablePage";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

export default function ScheduledMessagesPage() {
  if (resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true)) {
    return <IcpUnavailablePage title="Scheduled messages are unavailable in ICP lab mode" description="Message scheduling and external delivery workers are not connected to the ICP messaging service yet." />;
  }
  return <SupabaseScheduledMessagesPage />;
}

function SupabaseScheduledMessagesPage() {
  const navigate = useNavigate();
  const { hasAnyClubPro, isLoading: proLoading } = useUserHasAnyClubPro();
  const { activeClubFilter } = useClubTheme();
  const { hasPro: activeClubHasPro, isLoading: activeClubProLoading } = useClubProAccess(activeClubFilter);
  const { user } = useAuth();

  // Resolve a clubId for upgrade navigation on this global page
  const { data: firstClubId } = useQuery({
    queryKey: ["user-first-club", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id)
        .limit(1)
        .maybeSingle();
      if (roles?.club_id) return roles.club_id;
      if (roles?.team_id) {
        const { data: team } = await supabase
          .from("teams")
          .select("club_id")
          .eq("id", roles.team_id)
          .maybeSingle();
        return team?.club_id ?? null;
      }
      return null;
    },
  });

  const {
    data: pendingRows = [],
    isLoading: loadingPending,
    isError: pendingError,
    refetch: refetchPending,
    isFetching: pendingFetching,
  } = useAllScheduledMessages(["pending"]);
  const { data: recentRows = [] } = useAllScheduledMessages(["sent", "failed"]);
  const allRows = useMemo(() => [...pendingRows, ...recentRows], [pendingRows, recentRows]);
  const { data: labels = {} } = useThreadLabels(allRows);

  const [editingRow, setEditingRow] = useState<ScheduledMessageRow | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const cancelMut = useCancelScheduledMessage();

  const handleCancel = async () => {
    if (!confirmDeleteId) return;
    try {
      await cancelMut.mutateAsync(confirmDeleteId);
      toast.success("Scheduled message cancelled");
    } catch (e: any) {
      if (e?.code === "session_expired") {
        toast.error("Your session expired. Please sign in again.");
      } else {
        toast.error(e?.message || "Failed to cancel");
      }
    } finally {
      setConfirmDeleteId(null);
    }
  };

  // Group pending by date
  const groupedPending = useMemo(() => {
    const map = new Map<string, ScheduledMessageRow[]>();
    for (const row of pendingRows) {
      const d = new Date(row.scheduled_for);
      const key = format(d, "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      label: dateGroupLabel(new Date(items[0].scheduled_for)),
      items,
    }));
  }, [pendingRows]);

  // Recent (last 7 days) — already filtered to sent/failed
  const recentSorted = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return [...recentRows]
      .filter((r) => new Date(r.updated_at).getTime() >= sevenDaysAgo)
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )
      .slice(0, 20);
  }, [recentRows]);

  const totalPending = pendingRows.length;

  return (
    <div className="pb-10 max-w-2xl mx-auto">
      {/* Compact header */}
      <div className="border-b border-border bg-background/90 backdrop-blur-sm px-3 pt-2 pb-2.5 sticky top-0 z-10">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="h-9 w-9 -ml-2 shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Clock className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight truncate">Scheduled Messages</h1>
            <p className="text-[11px] text-muted-foreground leading-tight truncate">
              Messages scheduled to send later
            </p>
          </div>
          {totalPending > 0 && (
            <span className="text-[11px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
              {totalPending}
            </span>
          )}
        </div>
      </div>

      <div className="px-3 pt-4 space-y-6">
        {/* Pending */}
        <section className="space-y-2.5">
          {totalPending > 0 && (
            <div className="flex items-center justify-between px-1">
              <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Upcoming
              </h2>
            </div>
          )}
          {loadingPending ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-border bg-card p-4 animate-pulse"
                >
                  <div className="h-4 w-32 bg-muted rounded mb-2" />
                  <div className="h-3 w-20 bg-muted rounded mb-3" />
                  <div className="h-3 w-full bg-muted rounded" />
                </div>
              ))}
            </div>
          ) : pendingError && pendingRows.length === 0 ? (
            <div className="flex justify-center pt-6">
              <div
                role="alert"
                className="w-full rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-center shadow-sm"
              >
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-700 ring-1 ring-amber-500/30">
                  <AlertCircle className="h-6 w-6" />
                </div>
                <p className="font-semibold text-[15px]">
                  Scheduled messages couldn't be loaded
                </p>
                <p className="text-[13px] text-muted-foreground mt-1 max-w-[300px] mx-auto leading-snug">
                  Your existing scheduled messages have not been deleted and may
                  still send at their scheduled time.
                </p>
                <Button
                  size="sm"
                  className="mt-4"
                  onClick={() => refetchPending()}
                  disabled={pendingFetching}
                >
                  {pendingFetching ? "Retrying…" : "Try again"}
                </Button>
              </div>
            </div>
          ) : pendingRows.length === 0 ? (
            <div className="flex justify-center pt-6">
              <div className="w-full rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
                  <Clock className="h-6 w-6" />
                </div>
                <p className="font-semibold text-[15px]">No scheduled messages yet</p>
                {(() => {
                  // Prefer the active club's Pro status (matches the club shown in the header).
                  // Fall back to "any club" only when no active club is selected.
                  const isFree = activeClubFilter
                    ? !activeClubProLoading && !activeClubHasPro
                    : !proLoading && !hasAnyClubPro;
                  const upgradeClubId = activeClubFilter || firstClubId;
                  return isFree;
                })() ? (
                  <>
                    <p className="text-[13px] text-muted-foreground mt-1 max-w-[260px] mx-auto leading-snug">
                      Schedule messages to send later from any chat. Upgrade your club to Pro to unlock.
                    </p>
                    <Button
                      size="sm"
                      className="mt-4"
                      onClick={() => {
                        const upgradeClubId = activeClubFilter || firstClubId;
                        if (upgradeClubId) {
                          navigate(`/clubs/${upgradeClubId}/upgrade`);
                        } else {
                          navigate("/clubs");
                        }
                      }}
                    >
                      <Crown className="h-4 w-4 mr-2" />
                      Upgrade to Pro
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] text-muted-foreground mt-1 max-w-[260px] mx-auto leading-snug">
                      Open the <span className="font-medium text-foreground">More options</span> menu in any chat and choose <span className="font-medium text-foreground">Schedule message</span>, or long-press Send, to schedule a message for later.
                    </p>
                    <Button
                      size="sm"
                      className="mt-4"
                      onClick={() => navigate("/messages")}
                    >
                      Open Messages
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {groupedPending.map((group) => (
                <div key={group.key} className="space-y-2">
                  <h3 className="text-xs font-semibold text-foreground/70 px-1">
                    {group.label}
                  </h3>
                  <ul className="space-y-2">
                    {group.items.map((row) => {
                      const info = lookupLabel(row, labels);
                      const Icon = chatTypeIcon(row.chat_type);
                      const scheduledDate = new Date(row.scheduled_for);
                      const relative = formatDistanceToNow(scheduledDate, {
                        addSuffix: true,
                      });
                      return (
                        <li
                          key={row.id}
                          className="group rounded-2xl border border-border bg-card p-3.5 shadow-sm transition-all hover:shadow-md hover:border-primary/30"
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <button
                                type="button"
                                onClick={() => info.href && navigate(info.href)}
                                className="text-left w-full group/link"
                                disabled={!info.href}
                              >
                                <div className="flex items-center gap-1">
                                  <p className="text-sm font-semibold truncate group-hover/link:text-primary transition-colors">
                                    {info.label}
                                  </p>
                                  {info.href && (
                                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover/link:opacity-100 transition-opacity shrink-0" />
                                  )}
                                </div>
                                {info.sublabel && (
                                  <p className="text-xs text-muted-foreground truncate">
                                    {info.sublabel}
                                  </p>
                                )}
                              </button>
                              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground/80 bg-muted/70 px-2 py-0.5 rounded-md">
                                  <Clock className="h-3 w-3" />
                                  {format(scheduledDate, "h:mm a")}
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                  {relative}
                                </span>
                                {row.recurrence && row.recurrence !== "none" && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded-md">
                                    <Repeat className="h-2.5 w-2.5" />
                                    {row.recurrence}
                                  </span>
                                )}
                              </div>
                              <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-muted/40 px-2.5 py-2">
                                {row.image_url && (
                                  <ImageIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                                )}
                                <p className="text-sm break-words line-clamp-3 text-foreground/90">
                                  {row.text || (row.image_url ? "Image" : "")}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-col gap-1 shrink-0 -mr-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 rounded-lg"
                                onClick={() => setEditingRow(row)}
                                aria-label="Edit"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setConfirmDeleteId(row.id)}
                                aria-label="Cancel"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent */}
        {recentSorted.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Recent activity
            </h2>
            <ul className="space-y-2">
              {recentSorted.map((row) => {
                const info = lookupLabel(row, labels);
                const failed = row.status === "failed";
                const Icon = chatTypeIcon(row.chat_type);
                return (
                  <li
                    key={row.id}
                    className="rounded-2xl border border-border bg-card/60 p-3.5"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                          failed
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {failed ? (
                          <AlertCircle className="h-4 w-4" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-medium truncate">{info.label}</p>
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md ${
                              failed
                                ? "bg-destructive/10 text-destructive"
                                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            }`}
                          >
                            {failed ? "Failed" : "Sent"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Icon className="h-3 w-3" />
                          {format(new Date(row.updated_at), "MMM d, h:mm a")}
                        </p>
                        {failed && row.error_message && (
                          <p className="text-xs text-destructive mt-1.5 bg-destructive/5 rounded-md px-2 py-1">
                            {row.error_message}
                          </p>
                        )}
                        <p className="text-sm break-words line-clamp-2 mt-1.5 text-foreground/80">
                          {row.text || (row.image_url ? "(Image only)" : "")}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {editingRow && (
        <Suspense fallback={null}>
          <ScheduleMessageDialog
            open
            onOpenChange={(o) => !o && setEditingRow(null)}
            target={rowTarget(editingRow)}
            editingRow={editingRow}
          />
        </Suspense>
      )}

      <AlertDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel scheduled message?</AlertDialogTitle>
            <AlertDialogDescription>
              This message won't be sent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel}>
              Cancel message
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
