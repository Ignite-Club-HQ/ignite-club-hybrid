/** Classify the failure without treating access refusal as empty membership. */
export function clubCreationFailureKind(error: unknown): 'admission' | 'technical' | 'ordinary' {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? error ?? '');
  if (/Account admission denied or unavailable|Account removal fenced|Cross-group eligibility not released|Configured (service reader|authority) required/i.test(message)) return 'admission';
  return /replica returned|IC0\d{3}|Call context:|HTTP details:|Request ID:/i.test(message) ? 'technical' : 'ordinary';
}

export function clubCreationErrorMessage(error: unknown): string {
  const kind = clubCreationFailureKind(error);
  if (kind === 'admission') return "We couldn't confirm your account's access to the new club group. An administrator needs to check the group's account connection before you try again.";
  if (kind === 'technical') return "We couldn't create your club right now. Please try again later; if it keeps happening, let an administrator know.";
  const message = error instanceof Error ? error.message : (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : "We couldn't create your club. Please try again.";
}