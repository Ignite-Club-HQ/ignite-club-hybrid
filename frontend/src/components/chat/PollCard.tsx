import { useEffect, useMemo, useState } from "react";
import { pollErrorMessage } from "@/lib/pollErrorMessage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { currentChatScope, chatWrite } from "@/live/chatScope";
import { BarChart3, Check, Clock, Lock, Loader2, MoreVertical, Trash2, Users, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { withFeatureBackend } from "@/live/featureRouter";
import { voteLivePoll, closeLivePoll, deleteLivePoll } from "@/live/features/messaging";
import { pollQueryOptions, type PollData } from "@/lib/pollReadRepository";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerClose } from "@/components/ui/drawer";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { fetchProfilesWithCache } from "@/lib/profileCache";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface PollCardProps {
  pollId: string;
}

export function PollCard({ pollId }: PollCardProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [busyOptionId, setBusyOptionId] = useState<string | null>(null);
  const [votesOpen, setVotesOpen] = useState(false);

  const icpMode = isFeatureRoutedToIcp("messaging");
  const scope = currentChatScope();
  const pollKey = ["poll", pollId, user?.id, JSON.stringify(scope ?? null)];

  const { data, isLoading, isError, refetch } = useQuery({
    ...pollQueryOptions(pollId, user?.id, scope, icpMode),
    enabled: !icpMode || (!!user && !!scope),
    retry: 1,
    // Each refresh is a canister call per poll on screen; 10s per card piled
    // up behind the chat's own reads. Refresh slower and only while visible.
    refetchInterval: icpMode ? 30_000 : false,
    refetchIntervalInBackground: false,
  });

  // Realtime: refresh on any vote change for this poll. Skipped when
  // messaging is ICP-routed (canisters are request/response, no channel to
  // subscribe to) in favour of a 30s poll fallback below.
  useEffect(() => {
    if (icpMode) return;
    const channel = supabase
      .channel(`poll-${pollId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "poll_votes", filter: `poll_id=eq.${pollId}` },
        () => refetch()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "polls", filter: `id=eq.${pollId}` },
        () => refetch()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [pollId, refetch, icpMode]);

  const isClosed = useMemo(() => {
    if (!data?.poll) return false;
    if (data.closed) return true;
    if (data.poll.closed_at) return true;
    if (data.poll.closes_at && new Date(data.poll.closes_at).getTime() <= Date.now()) return true;
    return false;
  }, [data]);

  const totalVotes = data?.votes.length ?? 0;
  const voterIds = [...new Set((data?.votes ?? []).map(v => v.user_id).filter(Boolean))].sort();
  const voterProfiles = useQuery({
    queryKey: ["poll-voter-profiles", pollId, user?.id, JSON.stringify(scope ?? null), voterIds],
    queryFn: () => fetchProfilesWithCache(voterIds),
    enabled: votesOpen && voterIds.length > 0,
    staleTime: 60_000,
  });
  const myVoteOptionIds = useMemo(() => {
    return new Set((data?.votes || []).filter(v => v.user_id === user?.id).map(v => v.option_id));
  }, [data?.votes, user?.id]);

  const voteCountByOption = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of data?.votes || []) {
      map.set(v.option_id, (map.get(v.option_id) || 0) + 1);
    }
    return map;
  }, [data?.votes]);

  const voteMutation = useMutation({
    onMutate: async (optionId: string) => {
      if (!icpMode || !user) return undefined;
      await qc.cancelQueries({ queryKey: pollKey, exact: true });
      const previous = qc.getQueryData<PollData | null>(pollKey);
      if (!previous) return undefined;
      setBusyOptionId(optionId);
      qc.setQueryData<PollData>(pollKey, { ...previous, votes: [
        ...previous.votes.filter(v => v.user_id !== user.id),
        { id: `${pollId}:${user.id}`, user_id: user.id, option_id: optionId },
      ] });
      return { previous };
    },
    mutationFn: async (optionId: string) => {
      if (icpMode) {
        const optionIndex = Number(optionId);
        await withFeatureBackend("messaging", {
          supabase: async () => {
            throw new Error("unreachable");
          },
          icp: (ctx) => voteLivePoll(ctx, pollId, optionIndex),
        }, chatWrite(scope));
        return;
      }
      if (!user || !data?.poll) return;
      setBusyOptionId(optionId);
      const alreadyVoted = myVoteOptionIds.has(optionId);

      if (alreadyVoted) {
        const { error } = await supabase
          .from("poll_votes")
          .delete()
          .eq("poll_id", pollId)
          .eq("option_id", optionId)
          .eq("user_id", user.id);
        if (error) throw error;
        return;
      }

      // Single-choice: clear any previous vote first
      if (!data.poll.allow_multiple && myVoteOptionIds.size > 0) {
        const { error: delErr } = await supabase
          .from("poll_votes")
          .delete()
          .eq("poll_id", pollId)
          .eq("user_id", user.id);
        if (delErr) throw delErr;
      }

      const { error } = await supabase
        .from("poll_votes")
        .insert({ poll_id: pollId, option_id: optionId, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => {
      refetch();
    },
    onError: (e: any, _optionId, context) => {
      if (context?.previous) qc.setQueryData(pollKey, context.previous);
      toast.error(pollErrorMessage(e, "Failed to record vote"));
    },
    onSettled: () => setBusyOptionId(null),
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      if (icpMode) {
        await withFeatureBackend("messaging", {
          supabase: async () => {
            throw new Error("unreachable");
          },
          icp: (ctx) => closeLivePoll(ctx, pollId),
        }, chatWrite(scope));
        return;
      }
      const { error } = await supabase
        .from("polls")
        .update({ closed_at: new Date().toISOString() })
        .eq("id", pollId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Poll closed");
      refetch();
    },
    onError: (e: any) => toast.error(pollErrorMessage(e, "Failed to close poll")),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (icpMode) {
        await withFeatureBackend("messaging", {
          supabase: async () => {
            throw new Error("unreachable");
          },
          icp: (ctx) => deleteLivePoll(ctx, pollId),
        }, chatWrite(scope));
        return;
      }
      const { error } = await supabase.from("polls").delete().eq("id", pollId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Poll deleted");
      qc.invalidateQueries({ queryKey: pollKey });
    },
    onError: (e: any) => toast.error(pollErrorMessage(e, "Failed to delete poll")),
  });

  if (isLoading) {
    // Fixed-height skeleton matches estimator (PREVIEW_HEIGHT_BY_TOKEN.poll = 180)
    // so the row doesn't grow when the poll resolves.
    return (
      <div className="rounded-2xl border border-border bg-card/50 w-full max-w-[320px] h-[180px] flex items-center justify-center">
        <div className="w-full px-3.5 space-y-3" aria-busy="true" aria-label="Poll">
          <div className="h-5 w-3/4 rounded bg-muted animate-pulse" />
          <div className="h-10 rounded bg-muted animate-pulse" />
          <div className="h-10 rounded bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (isError && !data) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-3 max-w-sm text-sm text-muted-foreground">
        <p>We couldn’t load this poll.</p>
        <Button variant="ghost" size="sm" onClick={() => void refetch()}>Try again</Button>
      </div>
    );
  }

  if (!data?.poll) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-3 max-w-sm text-sm text-muted-foreground">
        Poll unavailable
      </div>
    );
  }

  const { poll, options } = data;
  const isCreator = user?.id === poll.created_by;
  const closesIn = poll.closes_at ? new Date(poll.closes_at) : null;

  return (
    <div className="rounded-2xl border border-border bg-card text-card-foreground w-full max-w-[320px] overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-3 px-3.5 pt-3 pb-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <BarChart3 className="h-4 w-4" strokeWidth={2.25} />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-[15px] font-semibold leading-snug break-words">{poll.question}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {poll.allow_multiple ? "Multiple choice" : "Single choice"}
            {isClosed && " · Closed"}
          </p>
        </div>
        {isCreator && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="-mr-1.5 -mt-0.5 h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground transition-colors"
                aria-label="Poll actions"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!isClosed && (
                <DropdownMenuItem onClick={() => closeMutation.mutate()}>
                  <Lock className="h-4 w-4 mr-2" /> Close poll
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  if (confirm("Delete this poll? Votes will be removed.")) deleteMutation.mutate();
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Delete poll
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Options */}
      <div className="px-3.5 space-y-2">
        {options.map((opt) => {
          const count = voteCountByOption.get(opt.id) || 0;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const selected = myVoteOptionIds.has(opt.id);
          const disabled = isClosed || voteMutation.isPending || busyOptionId !== null;
          return (
            <button
              key={opt.id}
              onClick={() => !disabled && voteMutation.mutate(opt.id)}
              disabled={disabled}
              aria-pressed={selected}
              aria-busy={busyOptionId === opt.id}
              className={`relative w-full text-left rounded-xl border overflow-hidden transition-colors min-h-[44px] ${
                selected ? "border-primary/60" : "border-border"
              } ${disabled && !selected ? "opacity-90" : "hover:bg-muted/40 active:bg-muted/60"} ${
                disabled ? "cursor-default" : "cursor-pointer"
              }`}
            >
              <div
                className={`absolute inset-y-0 left-0 ${
                  selected ? "bg-primary/20" : "bg-muted/50"
                } transition-[width] duration-300`}
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  {busyOptionId === opt.id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                  ) : selected ? (
                    <Check className="h-4 w-4 text-primary shrink-0" strokeWidth={2.5} />
                  ) : (
                    <span className="h-4 w-4 rounded-full border border-muted-foreground/40 shrink-0" />
                  )}
                  <span className={`text-sm truncate ${selected ? "font-medium" : ""}`}>{opt.label}</span>
                </div>
                <span className="text-[11px] font-medium text-muted-foreground shrink-0 tabular-nums">
                  {count} · {pct}%
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-2.5 px-3.5 py-2 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="font-medium">
          {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
        </span>
        {closesIn && !isClosed && (
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Closes {formatDistanceToNow(closesIn, { addSuffix: true })}
          </span>
        )}
        {isClosed && (
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3 w-3" />
            Closed
          </span>
        )}
      </div>
      <div className="px-3.5 pb-2">
        <Button variant="ghost" size="sm" className="w-full gap-2" onClick={() => setVotesOpen(true)}>
          <Users className="h-4 w-4" />View votes
        </Button>
      </div>
      <Drawer open={votesOpen} onOpenChange={setVotesOpen}>
        <DrawerContent className="max-h-[80dvh]">
          <DrawerHeader className="relative mx-auto w-full max-w-lg pr-14">
            <DrawerTitle>Votes</DrawerTitle>
            <DrawerDescription className="break-words">{poll.question}</DrawerDescription>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="absolute right-3 top-2" aria-label="Close votes">
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </DrawerHeader>
          <div className="mx-auto w-full max-w-lg overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
            {icpMode && data.voterDetailsAvailable === false ? (
              <p className="py-4 text-sm text-muted-foreground">Voter names will be available after the chat service update.</p>
            ) : options.map(option => {
              const votes = data.votes.filter(v => v.option_id === option.id);
              return <section key={option.id} className="border-t border-border py-4">
                <h3 className="flex items-start justify-between gap-3 text-sm font-semibold">
                  <span className="break-words">{option.label}</span>
                  <span className="shrink-0 text-muted-foreground">{votes.length}</span>
                </h3>
                {votes.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No votes yet</p> : (
                  <ul className="mt-3 space-y-3">
                    {votes.map(vote => {
                      const profile = voterProfiles.data?.get(vote.user_id);
                      const name = profile?.display_name || (vote.user_id === user?.id ? "You" : "Member");
                      return <li key={vote.id} className="flex items-center gap-3">
                        <Avatar className="h-8 w-8 shrink-0">
                          {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt="" />}
                          <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 break-words text-sm">{name}</span>
                      </li>;
                    })}
                  </ul>
                )}
              </section>;
            })}
            {voterProfiles.isError && <Button variant="ghost" size="sm" onClick={() => void voterProfiles.refetch()}>Retry names</Button>}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
