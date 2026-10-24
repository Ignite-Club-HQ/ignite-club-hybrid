export type VaultBackupSink = {
  write(chunk: string): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
};

/** Close commits only a complete validated export; abort discards temporary writes. */
export async function writeVaultBackupChunks(chunks: AsyncIterable<string>, sink: VaultBackupSink): Promise<void> {
  try {
    for await (const chunk of chunks) await sink.write(chunk);
    await sink.close();
  } catch (error) {
    try { await sink.abort(error); } catch { /* original failure must remain visible */ }
    throw error;
  }
}

/** Must be called directly from a user gesture, before any authorization/network await. */
export function chooseVaultBackupSink(filename: string): Promise<VaultBackupSink | null> {
  const browser = window as Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<VaultBackupSink> }> };
  if (!browser.showSaveFilePicker) return Promise.resolve(null);
  return browser.showSaveFilePicker({ suggestedName: filename }).then(handle => handle.createWritable());
}