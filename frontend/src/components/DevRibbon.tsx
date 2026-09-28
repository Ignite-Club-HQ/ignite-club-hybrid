import { IS_DEV_ENV, SUPABASE_PROJECT_REF } from "@/lib/env";

/**
 * Small fixed "DEV" badge shown only when the app is pointed at the dev
 * Supabase project. Rendered above every route so you can never confuse
 * a dev build for a prod build.
 *
 * Renders nothing in prod builds — zero visual or runtime cost.
 */
export const DevRibbon = () => {
  // Hidden on all environments (removed per user request for cleaner screenshots).
  void IS_DEV_ENV;
  void SUPABASE_PROJECT_REF;
  return null;
};

export default DevRibbon;
