export function unwrapQueueResult(result, action) {
  if (!result || typeof result !== "object" || !("Ok" in result)) {
    throw new Error(`${action}: ${result?.Err ?? "invalid canister response"}`);
  }
  return result.Ok;
}