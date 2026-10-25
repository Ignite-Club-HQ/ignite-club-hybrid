/**
 * Which third-party sign-in providers the app offers.
 *
 * Default off on this project's unconfigured Supabase instance. Production
 * builds may explicitly enable it after verifying the existing provider and
 * callbacks; a frontend flag is not evidence that OAuth is configured.
 */
export function googleSignInEnabled(setting: unknown): boolean {
  return setting === "true";
}
export const GOOGLE_SIGN_IN_ENABLED = googleSignInEnabled(import.meta.env.IGNITE_LIVE_GOOGLE_SIGN_IN_ENABLED);
