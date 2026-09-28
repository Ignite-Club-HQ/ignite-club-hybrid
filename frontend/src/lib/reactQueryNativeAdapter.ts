import { onlineManager, focusManager, type QueryClient } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { abortAllInFlightRestGets } from '@/lib/supabaseAuthRetry';

const CHAT_RESUME_QUERY_KEYS = new Set([
  'team-messages',
  'club-messages',
  'group-messages',
  'dm-messages',
  'broadcast-messages',
  'club-admin-messages',
  'my-teams-with-messages',
  'member-clubs-with-messages',
  'my-chat-groups-with-messages',
  'dm-conversations',
  'latest-broadcast',
  'club-admin-conversations',
  'team-chat-preview',
  'unread-message-counts',
  'chat-group-unread-cache',
]);

/**
 * Configures React Query's onlineManager and focusManager for Capacitor
 * native environments where browser events don't fire reliably.
 *
 * Uses @capacitor/network for connectivity hints and @capacitor/app for
 * foreground/background state. Because iOS Low Power Mode and Android
 * Battery Saver/Doze can deliver stale `connected: false` callbacks and
 * then suppress further updates for minutes, we also run a lightweight
 * HEAD probe against Supabase (with exponential backoff, foreground-only)
 * to recover from a stuck-offline state, and re-probe on every app resume.
 *
 * When `queryClient` is provided, we ALSO actively refetch errored queries
 * on every offline→online transition and on every app resume. This is the
 * recovery path for Messages/Schedule/Media on Android: when a query has
 * already errored out (offlineFirst networkMode), React Query's built-in
 * `refetchOnReconnect` only refires the queryFn for queries with status
 * `success` — errored queries stay errored until something invalidates
 * them. We explicitly invalidate so blank pages recover without a relaunch.
 */
export function setupReactQueryNativeAdapter(queryClient?: QueryClient) {
  if (!Capacitor.isNativePlatform()) return;

  // Expose a nudge so `supabaseAuthRetry.ts` can trip recovery whenever a
  // Supabase fetch fails with a network-shaped error (TypeError / AbortError
  // from our own 25s timeout). Android WebView frequently does NOT fire the
  // `networkStatusChange` callback on brief carrier drops, so relying on the
  // OS event alone leaves pages (Media, Schedule, AppHeader club theme)
  // stuck on the failed query even after connectivity returns. This gives us
  // a second recovery trigger driven by observed request failures.
  try {
    (window as any).__igniteNudgeNetworkCheck = (reason?: string) => {
      // Cancel any current backoff and probe right away. If the probe
      // succeeds it will flip online + kick errored queries. If we're
      // already online, just kick errored queries directly so a hung page
      // (that errored during the drop) refetches now.
      if (onlineManager.isOnline()) {
        recoverErroredQueries(reason || 'fetch-failure-nudge');
      } else {
        probeDelay = 500;
        clearProbe();
        runProbe();
      }
    };
  } catch { /* noop */ }

  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;

  let probeTimer: ReturnType<typeof setTimeout> | null = null;
  let probeDelay = 1000; // start at ~1s, cap at 15s
  let isForeground = true;
  let probing = false;

  const clearProbe = () => {
    if (probeTimer) {
      clearTimeout(probeTimer);
      probeTimer = null;
    }
    probeDelay = 1000;
  };

  const runProbe = async (opts?: { force?: boolean }) => {
    if (probing) return;
    if (!supabaseUrl) return;
    if (!isForeground) return;
    if (onlineManager.isOnline() && !opts?.force) {
      clearProbe();
      return;
    }
    probing = true;
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 4000);
      // Hit Supabase root; any 2xx/3xx/4xx response means the network works.
      const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: ctrl.signal,
      }).catch(() => null);
      clearTimeout(timeout);
      if (res) {
        const wasOnline = onlineManager.isOnline();
        onlineManager.setOnline(true);
        clearProbe();
        if (wasOnline) {
          // Already considered online — just heal anything that errored.
          recoverErroredQueries('probe-ok');
          return;
        }
        // Probe succeeded after being offline — a genuine reconnect.
        recoverErroredQueries('probe-recovered', { refetchActive: true });
        return;
      }
    } finally {
      probing = false;
    }
    // Still offline — schedule next probe with backoff (cap 15s). A 60s cap
    // meant a Doze/Low-Power latched `connected: false` could keep React Query
    // paused for a full minute after connectivity actually returned.
    probeDelay = Math.min(probeDelay * 2, 15000);
    if (isForeground) {
      probeTimer = setTimeout(runProbe, probeDelay);
    }
  };

  // Recovery on reconnect / resume. Two DIFFERENT surfaces, deliberately
  // kept separate — conflating them is what caused the resume freeze:
  //
  //   A. `refetchActive: true` — refetch EVERY actively-observed query.
  //      ONLY valid after a genuine offline→online transition, where we must
  //      assume mounted queries hold data fetched while the network was down.
  //      Expensive: the Inbox alone mounts ~25-30 active queries and Android
  //      WebView allows ~6 connections per origin, so this is dripped in
  //      batches, never fired in one tick.
  //
  //   B. `refetchActive: false` (DEFAULT) — only revive queries that are
  //      genuinely broken (error / paused / idle-non-success), plus the
  //      theme/club keys. This is what a plain app resume gets.
  //
  // A resume is NOT a reconnect. Healthy queries still hold valid data, and
  // blanket-refetching them on every resume saturated the connection pool;
  // if any slot was held by a zombie socket the rest queued behind it and
  // the page sat on skeletons until a force-quit.
  let lastRecoveryAt = 0;
  let lastChatResumeAt = 0;
  // When the app went to background. Used to decide whether in-flight REST
  // GETs are worth keeping on resume (see LONG_BACKGROUND_MS).
  let backgroundedAt = 0;
  const LONG_BACKGROUND_MS = 20_000;

  // Requests that were in flight when Android suspended the WebView are
  // almost always sitting on a dead socket, and their abort timers were
  // frozen — so they never fail, never resolve, and hold connection slots.
  // Release them BEFORE the recovery refetch, otherwise the refetch queues
  // behind zombies and the screen stays on skeletons until a force-quit.
  const abortZombieRequests = (reason: string) => {
    try {
      const n = abortAllInFlightRestGets(reason);
      if (n > 0) console.log(`[NativeAdapter] aborted ${n} in-flight REST GET(s) on ${reason}`);
    } catch { /* noop */ }
  };

  const recoverActiveChatQueries = (reason: string) => {
    if (!queryClient) return;
    const now = Date.now();
    if (now - lastChatResumeAt < 2500) return;
    lastChatResumeAt = now;

    try {
      const activeChatQueries = queryClient
        .getQueryCache()
        .findAll({ type: 'active' })
        .filter((q) => {
          const firstKey = q.queryKey[0];
          return typeof firstKey === 'string' && CHAT_RESUME_QUERY_KEYS.has(firstKey);
        });

      if (activeChatQueries.length === 0) return;
      console.log(`[NativeAdapter] Refreshing ${activeChatQueries.length} active chat query/query(s) (${reason})`);

      const BATCH = 4;
      for (let i = 0; i < activeChatQueries.length; i += BATCH) {
        const slice = activeChatQueries.slice(i, i + BATCH);
        const delay = (i / BATCH) * 120;
        setTimeout(() => {
          slice.forEach((q) => {
            try {
              queryClient.refetchQueries({ queryKey: q.queryKey, exact: true });
            } catch { /* noop */ }
          });
        }, delay);
      }
    } catch (e) {
      console.warn('[NativeAdapter] recoverActiveChatQueries failed:', e);
    }
  };

  const recoverErroredQueries = (
    reason: string,
    opts?: { refetchActive?: boolean },
  ) => {
    if (!queryClient) return;
    const now = Date.now();
    if (now - lastRecoveryAt < 2000) return; // throttle bursty triggers
    lastRecoveryAt = now;
    const refetchActive = opts?.refetchActive === true;
    try {
      // A. Blanket refetch of observed queries — reconnect only. Dripped in
      //    batches of 6, 120ms apart, so we never saturate the ~6-connection
      //    pool or flood the main thread at the moment the user taps.
      if (refetchActive) {
        try {
          const active = queryClient.getQueryCache().findAll({ type: 'active' });
          const BATCH = 6;
          for (let i = 0; i < active.length; i += BATCH) {
            const slice = active.slice(i, i + BATCH);
            const delay = (i / BATCH) * 120;
            setTimeout(() => {
              slice.forEach((q) => {
                try {
                  queryClient.refetchQueries({ queryKey: q.queryKey, exact: true });
                } catch { /* noop */ }
              });
            }, delay);
          }
        } catch { /* noop */ }
      }



      // 2. Also invalidate errored/paused/idle-non-success queries so they
      //    come back to life the next time their component mounts.
      const cache = queryClient.getQueryCache();
      const stuck = cache.getAll().filter((q) => {
        const s = q.state;
        return (
          s.status === 'error' ||
          (s.fetchStatus === 'idle' && s.status !== 'success') ||
          s.fetchStatus === 'paused'
        );
      });
      if (stuck.length > 0) {
        console.log(`[NativeAdapter] Recovering ${stuck.length} stuck queries (${reason})`);
        stuck.forEach((q) => {
          try {
            queryClient.invalidateQueries({ queryKey: q.queryKey, exact: true });
          } catch { /* noop */ }
        });
      }
      // Kick critical theme/club queries regardless of state — they may be
      // disabled (user=null) during a transient SIGNED_OUT and miss the
      // reconnect window otherwise.
      try {
        queryClient.invalidateQueries({ queryKey: ['club-themes'] });
        queryClient.invalidateQueries({ queryKey: ['user-clubs-for-switcher'] });
        queryClient.invalidateQueries({ queryKey: ['all-user-clubs-for-theme-v2'] });
      } catch { /* noop */ }
    } catch (e) {
      console.warn('[NativeAdapter] recoverErroredQueries failed:', e);
    }
  };

  // Proof-of-connectivity healing. `recoverErroredQueries` only ran on
  // foreground resume / reconnect events, so a session that was backgrounded
  // and then resumed while the OS suppressed both events kept its errored
  // queries dead. Any query that succeeds proves the network works — use that
  // as an extra trigger. Still bounded by the same 2s throttle inside
  // `recoverErroredQueries`, and it self-terminates once nothing is stuck.
  if (queryClient) {
    try {
      const cache = queryClient.getQueryCache();
      cache.subscribe((event) => {
        if (event?.type !== 'updated') return;
        const action = (event as { action?: { type?: string } }).action;
        if (action?.type !== 'success') return;
        const hasStuck = cache
          .getAll()
          .some((q) => q.state.status === 'error' || q.state.fetchStatus === 'paused');
        if (!hasStuck) return;
        if (!onlineManager.isOnline()) onlineManager.setOnline(true);
        recoverErroredQueries('query-success-proof');
      });
    } catch { /* noop */ }
  }




  const scheduleProbeIfOffline = () => {
    if (onlineManager.isOnline()) {
      clearProbe();
      return;
    }
    if (!isForeground) return;
    if (probeTimer) return;
    probeTimer = setTimeout(runProbe, probeDelay);
  };

  // --- Online Manager via Capacitor Network plugin ---
  onlineManager.setEventListener((setOnline) => {
    const listenerPromise = import('@capacitor/network').then(({ Network }) => {
      Network.getStatus().then((status) => {
        setOnline(status.connected);
        if (!status.connected) scheduleProbeIfOffline();
      });
      return Network.addListener('networkStatusChange', (status) => {
        const wasOnline = onlineManager.isOnline();
        setOnline(status.connected);
        if (status.connected) {
          clearProbe();
          // Genuine offline→online transition (guarded by !wasOnline).
          if (!wasOnline) recoverErroredQueries('network-reconnect', { refetchActive: true });
        } else {
          scheduleProbeIfOffline();
        }
      });
    });

    return () => {
      listenerPromise.then((listener) => listener.remove());
      clearProbe();
    };
  });

  // --- Focus Manager via Capacitor App plugin ---
  import('@capacitor/app').then(({ App }) => {
    focusManager.setEventListener((handleFocus) => {
      const listenerPromise = App.addListener('appStateChange', ({ isActive }) => {
        isForeground = isActive;
        if (isActive) {
          const hiddenFor = backgroundedAt ? Date.now() - backgroundedAt : 0;
          backgroundedAt = 0;
          // Abort-then-refetch. Must happen before handleFocus/recovery so the
          // connection pool is free when the recovery drip starts.
          if (hiddenFor >= LONG_BACKGROUND_MS) abortZombieRequests('app-resume');
          handleFocus();
          // Capture the online state BEFORE we mutate it below, so we can tell
          // an ordinary online resume from a genuine offline→online transition
          // that Android never announced via `networkStatusChange`.
          const wasOnline = onlineManager.isOnline();
          // On resume, re-check connectivity rather than trusting the cached
          // value (Low Power Mode / Doze can have left it stale).
          // ALWAYS probe on resume, even when the OS reports offline:
          // @capacitor/network can latch `connected: false` through iOS Low
          // Power Mode / Android Doze and then never emit an update, which
          // pauses every query. The probe is the authoritative signal.
          probeDelay = 1000;
          clearProbe();
          void runProbe({ force: true });
          import('@capacitor/network').then(({ Network }) => {
            Network.getStatus().then((status) => {
              if (status.connected) {
                onlineManager.setOnline(true);
                clearProbe();
                // Ordinary online resume: revive only broken queries. Blanket-
                // refetching every observed query here is what saturated the
                // connection pool and froze the UI.
                // Genuine offline→online resume (wasOnline === false): perform
                // exactly one controlled active-query recovery.
                recoverErroredQueries('app-resume', wasOnline ? undefined : { refetchActive: true });
                if (hiddenFor > 0) recoverActiveChatQueries(`app-resume:${Math.round(hiddenFor)}ms`);

              } else {
                // OS says offline — the forced probe above is already deciding.
                // Schedule follow-up attempts in case it fails.
                scheduleProbeIfOffline();
              }
            });
          });
        } else {
          backgroundedAt = Date.now();
          clearProbe();
        }
      });

      return () => {
        listenerPromise.then((listener) => listener.remove());
      };
    });
  });

  // Belt-and-braces: Android WebView sometimes delivers `visibilitychange`
  // without a matching `appStateChange`. Track hidden time here too so the
  // zombie abort still runs on those resumes. Chat refresh is scoped and
  // throttled, so it is safe to use here when appStateChange is missing.
  try {
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (hiddenFor > 0) recoverActiveChatQueries(`visibility-resume:${Math.round(hiddenFor)}ms`);
      if (hiddenFor >= LONG_BACKGROUND_MS) {
        abortZombieRequests('visibility-resume');
        recoverErroredQueries('visibility-resume');
      }
    });
  } catch { /* noop */ }
}
