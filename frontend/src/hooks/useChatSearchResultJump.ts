import { useCallback, useEffect, useRef } from "react";

interface Options<T extends { id: string }> {
  scopeKey: string;
  getMessages: () => T[];
  closeSearch: () => void;
  jump: (id: string) => unknown;
  loadContext: (target: T) => Promise<T[]>;
  mergeContext: (rows: T[]) => void;
}

/** Reveal the authorized result first; optional context must never delay it. */
export function useChatSearchResultJump<T extends { id: string }>(options: Options<T>) {
  const latest = useRef(options);
  latest.current = options;
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, [options.scopeKey]);

  return useCallback((id: string) => {
    const selected = latest.current;
    const token = ++generation.current;
    const isCurrent = () => generation.current === token && latest.current.scopeKey === selected.scopeKey;
    const target = selected.getMessages().find((row) => row.id === id);
    selected.closeSearch();
    requestAnimationFrame(() => { if (isCurrent()) latest.current.jump(id); });
    if (!target) return;
    void selected.loadContext(target).then((rows) => {
      if (isCurrent() && rows.length) latest.current.mergeContext(rows);
    }).catch(() => { /* Context enrichment is optional; the jump already started. */ });
  }, []);
}