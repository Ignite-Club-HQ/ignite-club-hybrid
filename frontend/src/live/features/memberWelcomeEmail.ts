/**
 * Member self-registered competition welcome emails (ICP mode).
 *
 * Supabase sends a welcome email when an existing member's team accepts a
 * competition entry, reading the recipient from auth.users. ICP accounts
 * carry no email, so the member keeps an optional contact email in their
 * own PII record (pii_id = principal text, field_id = "contact_email",
 * owner = the member) and the client self-registers a welcome job on the
 * competition canister after accepting an entry. The canister verifies
 * membership; the delivery edge function reads the job back by token, so
 * the browser is never trusted for eligibility — only for the member's own
 * address, which they can only misuse against themselves.
 *
 * Everything here is best effort: a missing email or failed send never
 * blocks the entry acceptance.
 */
import type { FeatureBackendContext } from "../featureRouter";
import { getLiveCompetitionWelcomeEmail, registerLiveMemberWelcomeJob } from "./competitions";
import { registerLivePiiText, resolveLivePiiTextBatch } from "./vault";
// icp-guard: allow external email transport only; eligibility and recipient jobs are registered and verified on competition_domain, and only the job token reaches this delivery endpoint.

export const CONTACT_EMAIL_FIELD_ID = "contact_email";

/** Reads the caller's own contact email, or null when unset/unreadable. */
export async function readLiveContactEmail(ctx: FeatureBackendContext): Promise<string | null> {
  const principal = ctx.identity.getPrincipal().toText();
  const rows = await resolveLivePiiTextBatch(
    ctx,
    [principal],
    CONTACT_EMAIL_FIELD_ID,
    "read_contact_email",
    "Read own contact email",
  );
  const value = rows.get(principal)?.trim();
  return value ? value : null;
}

/** Saves (upserts) the caller's own contact email. Best effort. */
export async function saveLiveContactEmail(ctx: FeatureBackendContext, email: string): Promise<void> {
  await registerLivePiiText(ctx, ctx.identity.getPrincipal().toText(), CONTACT_EMAIL_FIELD_ID, email.trim());
}

/**
 * Sends the competition welcome email to the caller after their team
 * accepted an entry, when the competition has welcome emails enabled and
 * the caller has a contact email on file. Silent no-op otherwise.
 */
export async function maybeSendLiveMemberWelcomeEmail(
  ctx: FeatureBackendContext,
  competitionId: string,
): Promise<void> {
  try {
    const settings = await getLiveCompetitionWelcomeEmail(ctx, competitionId);
    if (!settings?.enabled) return;
    const email = await readLiveContactEmail(ctx);
    if (!email || !email.includes("@")) return;
    const token = crypto.randomUUID();
    await registerLiveMemberWelcomeJob(ctx, competitionId, token, email);
  } catch (error) {
    console.warn("[memberWelcomeEmail] skipped:", (error as Error)?.message);
  }
}
