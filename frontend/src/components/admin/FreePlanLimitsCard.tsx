import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FREE_CHAT_FILE_COUNT,
  FREE_CHAT_FILE_STORAGE_BYTES,
  FREE_CHAT_PHOTOS_PER_CYCLE,
  FREE_FILE_COUNT,
  FREE_FILE_STORAGE_BYTES,
  FREE_PHOTO_UPLOADS_PER_CYCLE,
  FREE_POLLS_PER_CYCLE,
  formatBytes,
} from "@/hooks/useClubFreeUsage";

const ROWS: { label: string; value: string }[] = [
  { label: "Photo uploads per cycle", value: String(FREE_PHOTO_UPLOADS_PER_CYCLE) },
  { label: "Chat photos per cycle", value: String(FREE_CHAT_PHOTOS_PER_CYCLE) },
  { label: "Vault files", value: `${FREE_FILE_COUNT} files / ${formatBytes(FREE_FILE_STORAGE_BYTES)}` },
  { label: "Chat files per cycle", value: `${FREE_CHAT_FILE_COUNT} files / ${formatBytes(FREE_CHAT_FILE_STORAGE_BYTES)}` },
  { label: "Polls per cycle", value: String(FREE_POLLS_PER_CYCLE) },
];

/**
 * Read-only summary of the Free-tier caps. The same limits apply on both
 * backends (Supabase and ICP) — they are defined once in useClubFreeUsage and
 * shared by every gate and usage meter. Pro clubs have no caps.
 *
 * Kept read-only on purpose: on Supabase the caps are also enforced inside
 * the database, so an editable value here would diverge from actual
 * enforcement. Changing a cap is a code change to useClubFreeUsage.ts.
 */
export function FreePlanLimitsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Free plan limits</CardTitle>
        <CardDescription>
          What Free clubs can use per monthly cycle. These limits are the same on Supabase and on the
          Internet Computer — both backends read one shared set of numbers, so a club keeps the same
          allowances whichever backend serves it. Pro clubs have no limits.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {ROWS.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 rounded-md border p-2">
            <p className="text-sm font-medium">{row.label}</p>
            <p className="text-sm tabular-nums text-muted-foreground">{row.value}</p>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          On the Internet Computer, overall photo capacity is instead bounded by the photo stores
          above (each holds 40 GB and stops taking new photos at 80% full).
        </p>
      </CardContent>
    </Card>
  );
}
