/** Display enrichment must never hold authorized attendance behind private names. */
export async function readEventDisplayNames<P>(
  readChildren: () => Promise<Map<string, string>>,
  readProfiles: () => Promise<P[]>,
): Promise<{ children: Map<string, string>; profiles: P[] }> {
  const [children, profiles] = await Promise.all([
    readChildren().catch(() => new Map<string, string>()),
    readProfiles().catch(() => [] as P[]),
  ]);
  return { children, profiles };
}