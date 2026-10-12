/**
 * Which third-party sign-in providers the app offers.
 *
 * Google is switched off: the Google provider is not enabled on this project's
 * Supabase instance, so tapping "Continue with Google" ends on Supabase's
 * "Unsupported provider" error page. To offer it again, first enable it in
 * Supabase (Authentication -> Sign In / Providers -> Google), then flip this to
 * true. Nothing else needs to change - every Google button is gated on this flag.
 */
export const GOOGLE_SIGN_IN_ENABLED = false;
