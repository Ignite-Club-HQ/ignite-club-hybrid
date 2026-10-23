/** Bound read coordination only; never replay or time-box mutations here. */
export async function withReadDeadline<T>(read: Promise<T>, label: string, timeoutMs = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out; please try again.`)), timeoutMs);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export function assertReadNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Read cancelled", "AbortError");
}