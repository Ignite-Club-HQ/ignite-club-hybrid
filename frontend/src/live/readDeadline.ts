/** Bound read coordination only; never replay or time-box mutations here. */
export async function withReadDeadline<T>(read: Promise<T>, label: string, timeoutMs = 20_000, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const interrupted = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out; please try again.`)), timeoutMs);
      onAbort = () => reject(new DOMException("Read cancelled", "AbortError"));
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([read, interrupted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

export function assertReadNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Read cancelled", "AbortError");
}