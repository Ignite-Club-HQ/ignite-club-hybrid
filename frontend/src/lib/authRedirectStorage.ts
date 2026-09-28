/**
 * Storage helpers for the invite → auth handoff.
 *
 * Some Android/iOS webviews (and privacy-restricted browser contexts) throw on
 * `sessionStorage` access. The invite "Create Account to Join" button used to
 * write three keys unguarded, so a throw meant the follow-up `navigate("/auth")`
 * never ran and the button appeared to do nothing. These helpers never throw and
 * the auth destination also carries the redirect in the URL as a fallback.
 */

export const AUTH_REDIRECT_PARAM = "redirect";

export function safeSessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSessionSet(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeSessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing to clean up */
  }
}

/** Build the `/auth` destination, carrying the post-auth path in the URL too. */
export function buildAuthPathWithRedirect(redirectPath: string): string {
  if (!redirectPath || !redirectPath.startsWith("/") || redirectPath.startsWith("//")) {
    return "/auth";
  }
  return `/auth?${AUTH_REDIRECT_PARAM}=${encodeURIComponent(redirectPath)}`;
}

export const AUTH_MODE_PARAM = "mode";
export const AUTH_NEXT_PARAM = "next";
export const AUTH_INVITE_PARAM = "invite";

/**
 * Build the `/auth` destination for an invite hand-off. The URL is the source
 * of truth: `mode=signup` selects the signup tab, `next` is the post-auth
 * destination, `invite` carries the invite token/id so the invite context can
 * be reconstructed even when sessionStorage writes are blocked.
 */
export function buildAuthPathWithIntent(opts: {
  next: string;
  mode?: "signup" | "signin";
  invite?: string | null;
}): string {
  const params = new URLSearchParams();
  const safeNext =
    opts.next && opts.next.startsWith("/") && !opts.next.startsWith("//") ? opts.next : null;
  if (opts.mode) params.set(AUTH_MODE_PARAM, opts.mode);
  if (safeNext) {
    params.set(AUTH_NEXT_PARAM, safeNext);
    // Back-compat: older readers look for `redirect`.
    params.set(AUTH_REDIRECT_PARAM, safeNext);
  }
  if (opts.invite) params.set(AUTH_INVITE_PARAM, opts.invite);
  const qs = params.toString();
  return qs ? `/auth?${qs}` : "/auth";
}

/** Read the URL-carried redirect fallback from a search string. */
export function readRedirectParam(search: string): string | null {
  try {
    const params = new URLSearchParams(search);
    const value = params.get(AUTH_NEXT_PARAM) ?? params.get(AUTH_REDIRECT_PARAM);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Read the full auth intent (mode / next / invite) from a search string. */
export function readAuthIntent(search: string): {
  mode: "signup" | "signin" | null;
  next: string | null;
  invite: string | null;
} {
  try {
    const params = new URLSearchParams(search);
    const rawMode = params.get(AUTH_MODE_PARAM);
    return {
      mode: rawMode === "signup" || rawMode === "signin" ? rawMode : null,
      next: params.get(AUTH_NEXT_PARAM) ?? params.get(AUTH_REDIRECT_PARAM) ?? null,
      invite: params.get(AUTH_INVITE_PARAM),
    };
  } catch {
    return { mode: null, next: null, invite: null };
  }
}

