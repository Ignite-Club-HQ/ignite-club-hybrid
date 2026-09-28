import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AccessibilityPrefs = {
  textScale: number; // 0.9 .. 1.5
  highContrast: boolean;
  reduceMotion: boolean;
  boldText: boolean;
};

export const DEFAULT_PREFS: AccessibilityPrefs = {
  textScale: 1,
  highContrast: false,
  reduceMotion: false,
  boldText: false,
};

export const TEXT_SCALE_STEPS = [
  { label: "Small", value: 0.9 },
  { label: "Default", value: 1 },
  { label: "Large", value: 1.15 },
  { label: "Larger", value: 1.3 },
  { label: "Largest", value: 1.5 },
];

const LS_KEY = "ignite_accessibility_prefs";

function clampScale(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.5, Math.max(0.9, n));
}

function readLocal(): AccessibilityPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      textScale: clampScale(Number(parsed?.textScale ?? 1)),
      highContrast: !!parsed?.highContrast,
      reduceMotion: !!parsed?.reduceMotion,
      boldText: !!parsed?.boldText,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function applyToDom(p: AccessibilityPrefs) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.style.setProperty("--app-font-scale", String(p.textScale));
  // Apply base font-size scaling on <html>; Tailwind rem units inherit.
  // Use 100% * scale so default browser font-size (16px) is preserved at 1×.
  html.style.fontSize = `${p.textScale * 100}%`;
  html.classList.toggle("hc", p.highContrast);
  html.classList.toggle("rm", p.reduceMotion);
  html.classList.toggle("bt", p.boldText);
}

type Ctx = {
  prefs: AccessibilityPrefs;
  setPrefs: (next: Partial<AccessibilityPrefs>) => void;
  reset: () => void;
};

const AccessibilityCtx = createContext<Ctx | null>(null);

export function AccessibilityPrefsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefsState] = useState<AccessibilityPrefs>(() => {
    const initial = readLocal();
    applyToDom(initial);
    return initial;
  });

  // Apply whenever prefs change.
  useEffect(() => {
    applyToDom(prefs);
  }, [prefs]);

  // Hydrate from server on login (server is source of truth).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("accessibility_prefs")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled || error || !data?.accessibility_prefs) return;
      const remote = data.accessibility_prefs as Partial<AccessibilityPrefs>;
      const merged: AccessibilityPrefs = {
        textScale: clampScale(Number(remote.textScale ?? 1)),
        highContrast: !!remote.highContrast,
        reduceMotion: !!remote.reduceMotion,
        boldText: !!remote.boldText,
      };
      setPrefsState(merged);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(merged));
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const persist = useCallback(
    async (next: AccessibilityPrefs) => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {}
      if (user?.id) {
        await supabase
          .from("profiles")
          .update({ accessibility_prefs: next as any })
          .eq("id", user.id);
      }
    },
    [user?.id]
  );

  const setPrefs = useCallback(
    (patch: Partial<AccessibilityPrefs>) => {
      setPrefsState((cur) => {
        const next: AccessibilityPrefs = {
          ...cur,
          ...patch,
          textScale: patch.textScale != null ? clampScale(patch.textScale) : cur.textScale,
        };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const reset = useCallback(() => {
    setPrefsState(DEFAULT_PREFS);
    persist(DEFAULT_PREFS);
  }, [persist]);

  const value = useMemo(() => ({ prefs, setPrefs, reset }), [prefs, setPrefs, reset]);

  return <AccessibilityCtx.Provider value={value}>{children}</AccessibilityCtx.Provider>;
}

export function useAccessibilityPrefs(): Ctx {
  const ctx = useContext(AccessibilityCtx);
  if (!ctx) {
    // Safe fallback when used outside provider (e.g. tests).
    return {
      prefs: DEFAULT_PREFS,
      setPrefs: () => {},
      reset: () => {},
    };
  }
  return ctx;
}
