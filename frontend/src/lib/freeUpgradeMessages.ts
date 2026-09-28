/**
 * Benefit-led upgrade copy for Free-tier cap moments. Keep these positive
 * (what Pro adds), not punitive.
 */
export const FREE_UPGRADE_MESSAGES = {
  photoCount:
    "You've used your 10 free photo uploads this cycle. Upgrade to Pro for unlimited uploads and storage.",
  fileCount:
    "You've used your 10 free file uploads this cycle. Upgrade to Pro for unlimited club document storage.",
  fileStorage:
    "Your club has used its 25 MB free file storage this cycle. Upgrade to Pro for unlimited document storage.",
  pollCount:
    "You've used your 2 free polls this cycle. Upgrade to Pro for unlimited polls.",
} as const;

export type FreeUpgradeKey = keyof typeof FREE_UPGRADE_MESSAGES;
