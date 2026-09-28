/**
 * Shared candid helpers for the live per-feature canister services.
 *
 * The raw dfx-generated actors (`_SERVICE` in lab/bindings/<domain>/declarations)
 * return `{ Ok: T } | { Err: string }` variants and take `[] | [T]` for opt
 * parameters, `bigint` for nat64, and `Uint8Array` for vec nat8. These helpers
 * unwrap that shape into throwing async calls so feature code reads like the
 * existing Supabase repositories.
 */

export type CandidResult<T> = { Ok: T } | { Err: string };

export async function unwrapCandid<T>(
  promise: Promise<CandidResult<T>>,
  label: string,
): Promise<T> {
  const result = await promise;
  if ("Err" in result) {
    throw new Error(`${label} failed: ${result.Err}`);
  }
  return result.Ok;
}

export function candidOpt<T>(value: T | null | undefined): [] | [T] {
  return value === null || value === undefined ? [] : [value];
}

export function unwrapCandidOpt<T>(value: [] | [T], label: string): T {
  if (value.length === 0) {
    throw new Error(`${label}: not found.`);
  }
  return value[0];
}

export function toNat64(value: number | Date): bigint {
  return BigInt(value instanceof Date ? value.getTime() : value);
}
