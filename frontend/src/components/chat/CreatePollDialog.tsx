import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Loader2, Plus, Trash2, BarChart3 } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { UsageMeter } from "@/components/subscription/UsageMeter";
import { useClubFreeUsage, notifyClubFreeUsageChanged } from "@/hooks/useClubFreeUsage";
import { FREE_UPGRADE_MESSAGES } from "@/lib/freeUpgradeMessages";
import type { Database } from "@/integrations/supabase/types";

export type PollChatType = Database["public"]["Enums"]["poll_chat_type"];

interface CreatePollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatType: PollChatType;
  chatId: string;
  onCreated: (pollId: string) => void;
  /** Optional — when omitted, the dialog resolves the club id from chatType/chatId. */
  clubId?: string | null;
}

const MAX_OPTIONS = 10;
const MIN_OPTIONS = 2;
const CLIENT_VALIDATION_MESSAGES = new Set([
  "Question is required",
  `Add at least ${MIN_OPTIONS} options`,
  "Options must be unique",
  "Invalid close time",
  "Close time must be in the future",
]);

const normalizeOption = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

function validatePoll(question: string, options: string[]) {
  const cleanQuestion = question.trim();
  const trimmedOptions = options.map((option) => option.trim());
  const cleanOptions = trimmedOptions.filter(Boolean);
  const optionCounts = new Map<string, number>();
  const duplicateOptionIndexes = new Set<number>();

  trimmedOptions.forEach((option) => {
    if (!option) return;
    const normalized = normalizeOption(option);
    optionCounts.set(normalized, (optionCounts.get(normalized) ?? 0) + 1);
  });

  trimmedOptions.forEach((option, index) => {
    if (!option) return;
    if ((optionCounts.get(normalizeOption(option)) ?? 0) > 1) {
      duplicateOptionIndexes.add(index);
    }
  });

  return {
    cleanQuestion,
    cleanOptions,
    duplicateOptionIndexes,
    questionError: cleanQuestion ? null : "Question is required",
    optionsError:
      cleanOptions.length < MIN_OPTIONS
        ? `Add at least ${MIN_OPTIONS} options`
        : duplicateOptionIndexes.size > 0
          ? "Options must be unique"
          : null,
  };
}

export function CreatePollDialog({ open, onOpenChange, chatType, chatId, onCreated, clubId: clubIdProp }: CreatePollDialogProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Resolve the owning club so we can show the Free-tier usage meter & enforce caps.
  const { data: resolvedClubId } = useQuery({
    queryKey: ["poll-club-resolve", chatType, chatId, clubIdProp],
    enabled: open && !clubIdProp && !!chatId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (clubIdProp) return clubIdProp;
      if (chatType === "club") return chatId;
      if (chatType === "team") {
        const { data } = await supabase.from("teams").select("club_id").eq("id", chatId).maybeSingle();
        return (data?.club_id as string) ?? null;
      }
      if (chatType === "group") {
        const { data } = await supabase.from("chat_groups").select("club_id").eq("id", chatId).maybeSingle();
        return (data?.club_id as string) ?? null;
      }
      return null;
    },
  });
  const clubId = clubIdProp ?? resolvedClubId ?? null;
  const { usage } = useClubFreeUsage(clubId);
  const atPollCap = !!usage && !usage.isPro && usage.poll.atCap;
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  // Stable per-row identifiers so React keys don't reuse a torn-down input's
  // state (focus, selection, error pulse) when an earlier option is removed.
  // Index keys would do exactly that on add/remove — the input below the
  // deleted one would inherit the deleted one's DOM state.
  const optionIdSeq = useRef(2);
  const optionIds = useRef<string[]>(["opt-0", "opt-1"]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [closesAt, setClosesAt] = useState<string>("");
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const reset = () => {
    setQuestion("");
    setOptions(["", ""]);
    optionIds.current = ["opt-0", "opt-1"];
    optionIdSeq.current = 2;
    setAllowMultiple(false);
    setClosesAt("");
    setSubmitAttempted(false);
  };

  const addOption = () => {
    if (options.length >= MAX_OPTIONS) return;
    optionIds.current = [...optionIds.current, `opt-${optionIdSeq.current++}`];
    setOptions([...options, ""]);
  };

  const removeOption = (idx: number) => {
    if (options.length <= MIN_OPTIONS) return;
    optionIds.current = optionIds.current.filter((_, i) => i !== idx);
    setOptions(options.filter((_, i) => i !== idx));
  };

  const updateOption = (idx: number, val: string) => {
    setOptions(options.map((option, i) => (i === idx ? val : option)));
  };

  const validation = useMemo(() => validatePoll(question, options), [question, options]);
  const showErrors = submitAttempted || question.length > 0 || options.some((option) => option.length > 0);

  const create = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");

      const currentValidation = validatePoll(question, options);
      if (currentValidation.questionError) throw new Error(currentValidation.questionError);
      if (currentValidation.optionsError) throw new Error(currentValidation.optionsError);

      let closesAtIso: string | null = null;
      if (closesAt) {
        const time = new Date(closesAt);
        if (Number.isNaN(time.getTime())) throw new Error("Invalid close time");
        if (time.getTime() <= Date.now()) throw new Error("Close time must be in the future");
        closesAtIso = time.toISOString();
      }

      const { data: poll, error: pollErr } = await supabase
        .from("polls")
        .insert({
          chat_type: chatType,
          chat_id: chatId,
          created_by: user.id,
          question: currentValidation.cleanQuestion,
          allow_multiple: allowMultiple,
          closes_at: closesAtIso,
        })
        .select("id")
        .single();

      if (pollErr || !poll) throw pollErr || new Error("Failed to create poll");

      const optionRows = currentValidation.cleanOptions.map((label, index) => ({
        poll_id: poll.id,
        label,
        position: index,
      }));

      const { error: optErr } = await supabase.from("poll_options").insert(optionRows);
      if (optErr) {
        await supabase.from("polls").delete().eq("id", poll.id);
        throw optErr;
      }

      return poll.id as string;
    },
    onSuccess: (pollId) => {
      notifyClubFreeUsageChanged(clubId);
      if (clubId) {
        queryClient.invalidateQueries({ queryKey: ["club-free-usage", clubId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["club-free-usage"] });
      }
      onCreated(pollId);
      reset();
      onOpenChange(false);
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to create poll";
      if (CLIENT_VALIDATION_MESSAGES.has(message)) return;
      toast.error(message);
    },
  });

  const handleCreate = () => {
    setSubmitAttempted(true);
    if (validation.questionError || validation.optionsError) return;
    if (atPollCap) {
      toast.error(FREE_UPGRADE_MESSAGES.pollCount);
      return;
    }
    create.mutate();
  };

  const minDateTime = format(new Date(Date.now() + 5 * 60 * 1000), "yyyy-MM-dd'T'HH:mm");

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !create.isPending) reset();
        onOpenChange(nextOpen);
      }}
    >
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Create poll
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Ask a question and let the chat vote.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4 pt-2">
          {usage && !usage.isPro && (
            <UsageMeter
              label="Free plan — polls this cycle"
              used={usage.poll.used}
              limit={usage.poll.limit}
              clubId={clubId}
              resetAt={usage.cycleEnd}
              capMessage={atPollCap ? FREE_UPGRADE_MESSAGES.pollCount : undefined}
            />
          )}
          <div>
            <Label htmlFor="poll-question">Question</Label>
            <Input
              id="poll-question"
              name="poll-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value.slice(0, 300))}
              placeholder="e.g. What time should we train Saturday?"
              maxLength={300}
              autoComplete="off"
              autoCapitalize="sentences"
              aria-invalid={showErrors && !!validation.questionError}
              className={cn(showErrors && validation.questionError && "border-destructive focus-visible:ring-destructive")}
            />
            {showErrors && validation.questionError && (
              <p className="mt-1 text-xs text-destructive">{validation.questionError}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Options</Label>
            {options.map((option, idx) => {
              const isDuplicate = showErrors && validation.duplicateOptionIndexes.has(idx);

              return (
                <div key={optionIds.current[idx] ?? `opt-fallback-${idx}`} className="flex gap-2">
                  <Input
                    name={`poll-option-${idx + 1}`}
                    value={option}
                    onChange={(e) => updateOption(idx, e.target.value.slice(0, 200))}
                    placeholder={`Option ${idx + 1}`}
                    maxLength={200}
                    autoComplete="off"
                    autoCapitalize="sentences"
                    aria-invalid={isDuplicate || (showErrors && !!validation.optionsError)}
                    className={cn(isDuplicate && "border-destructive focus-visible:ring-destructive")}
                  />
                  {options.length > MIN_OPTIONS && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeOption(idx)}
                      aria-label={`Remove option ${idx + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
            {showErrors && validation.optionsError && (
              <p className="text-xs text-destructive">{validation.optionsError}</p>
            )}
            {options.length < MAX_OPTIONS && (
              <Button type="button" variant="outline" size="sm" onClick={addOption} className="w-full">
                <Plus className="h-4 w-4 mr-1" /> Add option
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Allow multiple selections</p>
              <p className="text-xs text-muted-foreground">Voters can choose more than one option</p>
            </div>
            <Switch checked={allowMultiple} onCheckedChange={setAllowMultiple} />
          </div>

          <div>
            <Label htmlFor="poll-closes">Close time (optional)</Label>
            <Input
              id="poll-closes"
              name="poll-closes"
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              min={minDateTime}
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Leave empty to keep the poll open until you close it manually.
            </p>
          </div>
        </div>

        <ResponsiveDialogFooter>
          {atPollCap && clubId ? (
            <Button
              className="w-full"
              variant="default"
              onClick={() => {
                onOpenChange(false);
                navigate(`/clubs/${clubId}/upgrade`);
              }}
            >
              <Crown className="h-4 w-4 mr-2" />
              Upgrade to Pro
            </Button>
          ) : (
            <Button className="w-full" onClick={handleCreate} disabled={create.isPending || atPollCap}>
              {create.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <BarChart3 className="h-4 w-4 mr-2" />
              )}
              Create poll
            </Button>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
