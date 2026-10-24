export function vaultDeletionCandidates(
  items: readonly { id: string; type: "photo" | "file"; size: number }[],
  icp: boolean,
) {
  return items.map(item => ({ id: item.id, type: icp ? "file" as const : item.type, size: item.size }));
}