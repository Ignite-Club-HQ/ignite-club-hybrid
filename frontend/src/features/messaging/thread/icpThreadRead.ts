/** Existing conversations must open before optional provisioning or enrichment. */
export async function readIcpThreadPage<T>(read: () => Promise<T>, provision?: () => Promise<unknown>): Promise<T> {
  try { return await read(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Only an explicit missing conversation warrants one provisioning attempt.
    // Transport/admission failures must never manufacture a replacement room.
    if (!provision || !/(?:Conversation|Chat) not found/i.test(message)) throw error;
    await provision();
    return read();
  }
}