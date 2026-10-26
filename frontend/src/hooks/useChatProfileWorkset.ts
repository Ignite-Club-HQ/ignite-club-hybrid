import { useCallback, useMemo, useState } from 'react';
import { chatProfileWorkset, type ProfileWorksetMessage } from '@/lib/chatProfileWorkset';

export function useChatProfileWorkset(
  messages: readonly ProfileWorksetMessage[], conversationId: string | undefined,
  viewerId: string | undefined,
  reactions: readonly { group_message_id?: string; user_id?: string | null }[] = [],
) {
  const scope = JSON.stringify([conversationId, viewerId]);
  const [window, setWindow] = useState<{ scope: string; ids: readonly string[] }>();
  const onVisibleMessageIds = useCallback((ids: readonly string[]) => {
    setWindow(previous => previous?.scope === scope && JSON.stringify(previous.ids) === JSON.stringify(ids)
      ? previous : { scope, ids: [...ids] });
  }, [scope]);
  const ids = useMemo(() => chatProfileWorkset(messages, window?.scope === scope ? window.ids : undefined, reactions),
    [messages, window, scope, reactions]);
  return { ids, onVisibleMessageIds };
}