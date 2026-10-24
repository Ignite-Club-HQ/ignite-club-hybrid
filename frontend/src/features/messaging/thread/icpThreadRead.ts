/** Existing conversations must open before optional provisioning or enrichment. */
export async function readIcpThreadPage<T>(read: () => Promise<T>, provision?: () => Promise<unknown>, confirmAbsent?: () => Promise<boolean>): Promise<T> {
  try { return await read(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Only an explicit missing conversation warrants one provisioning attempt.
    // Transport/admission failures must never manufacture a replacement room.
    if (!provision) throw error;
    const explicitlyMissing = /(?:Conversation|Chat) not found/i.test(message);
    // Current canisters also return "access forbidden" when there is no
    // conversation. Never treat that refusal itself as proof of absence:
    // ask the same caller-authorized, same-canister location reader first.
    const ambiguousAbsence = /^(?:Open conversation|List latest messages|List messages) failed: Conversation access forbidden$/.test(message);
    if (!explicitlyMissing && !(ambiguousAbsence && confirmAbsent && await confirmAbsent())) throw error;
    await provision();
    return read();
  }
}

export async function readIcpGroupMetadata<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); }
  catch (error) {
    if (error instanceof Error && error.message === "Get group metadata failed: Group metadata not found") return null;
    throw error;
  }
}