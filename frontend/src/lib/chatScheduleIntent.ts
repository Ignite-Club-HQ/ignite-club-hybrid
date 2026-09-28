export type ChatScheduleTarget =
  | { chat_type: "team"; team_id: string }
  | { chat_type: "club"; club_id: string }
  | { chat_type: "group"; group_id: string }
  | { chat_type: "direct"; conversation_id: string }
  | { chat_type: "club_admin"; conversation_id: string }
  | { chat_type: "broadcast" };

type ScopedScheduleKind = Exclude<ChatScheduleTarget["chat_type"], "broadcast">;

export function buildChatScheduleTarget(kind: "broadcast"): { chat_type: "broadcast" };
export function buildChatScheduleTarget(
  kind: ScopedScheduleKind,
  scopeId?: string,
): ChatScheduleTarget | null;
export function buildChatScheduleTarget(
  kind: ChatScheduleTarget["chat_type"],
  scopeId?: string,
): ChatScheduleTarget | null {
  if (kind === "broadcast") return { chat_type: "broadcast" };
  if (!scopeId) return null;

  switch (kind) {
    case "team": return { chat_type: kind, team_id: scopeId };
    case "club": return { chat_type: kind, club_id: scopeId };
    case "group": return { chat_type: kind, group_id: scopeId };
    case "direct": return { chat_type: kind, conversation_id: scopeId };
    case "club_admin": return { chat_type: kind, conversation_id: scopeId };
  }
}

type ScheduledComposerCleanup = {
  setComposerText: (value: string) => void;
  clearDraft?: () => void;
  setImageUrl?: (value: null) => void;
};

export const resetChatComposerAfterSchedule = ({
  setComposerText,
  clearDraft,
  setImageUrl,
}: ScheduledComposerCleanup): void => {
  setComposerText("");
  setImageUrl?.(null);
  clearDraft?.();
};
