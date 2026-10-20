export function mergeCapacityResults(prior, results, wasmSha256) {
  const matching = prior?.environment === 'isolated-pocketic' && prior?.wasmSha256 === wasmSha256 ? prior.results || [] : [];
  return [...new Map([...matching, ...results].map(row => [row.name, row])).values()];
}