import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getActiveIcpTarget } from "@/live/targetRegistry";
import { listBlobStoreKeys } from "@/live/mediaStorage";

type StoreUsage = {
  key: string;
  canisterId: string;
  totalBytes: number;
  limitBytes: number;
  accepting: boolean;
  error?: string;
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

async function loadUsage(): Promise<StoreUsage[]> {
  const target = getActiveIcpTarget();
  const keys = listBlobStoreKeys(target);
  if (keys.length === 0) return [];
  const [{ getLiveBlobStoreUsage }, { getCurrentInternetIdentity }, { AnonymousIdentity }] = await Promise.all([
    import("@/live/blobStoreUpload"),
    import("@/live/internetIdentityAuth"),
    import("@icp-sdk/core/agent"),
  ]);
  const identity = (await getCurrentInternetIdentity()) ?? new AnonymousIdentity();
  return Promise.all(
    keys.map(async (key): Promise<StoreUsage> => {
      const canisterId = target.canisterIds[key];
      try {
        const usage = await getLiveBlobStoreUsage(target, identity, key);
        return {
          key,
          canisterId,
          totalBytes: Number(usage.total_bytes),
          limitBytes: Number(usage.capacity_limit_bytes),
          accepting: usage.accepting_uploads,
        };
      } catch (error) {
        return {
          key,
          canisterId,
          totalBytes: 0,
          limitBytes: 0,
          accepting: true,
          error: /get_usage|has no query method|IC0302|IC0536/.test(String(error))
            ? "Needs the next mainnet deploy to report fullness"
            : "Couldn't reach this store",
        };
      }
    }),
  );
}

/**
 * Photo stores (sharding). Stores are added as canister IDs media_blob_store,
 * media_blob_store_2, … in Canister configuration above; this card shows how
 * full each one is. A store stops taking new photos by itself at 80% full
 * and stays readable; new uploads go to the next open store.
 */
export function PhotoStoresCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-photo-stores"],
    queryFn: loadUsage,
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Photo stores</CardTitle>
        <CardDescription>
          Photos are spread across these stores. To add one, enter its ID as media_blob_store_2 (then _3, …) in
          Canister configuration. Each club's photos stay on one store; a store stops taking new photos at 80% full,
          and existing photos are never moved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">Checking stores…</p>}
        {!isLoading && (data?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">No photo store is set up yet.</p>
        )}
        {data?.map((store) => {
          const pct = store.limitBytes > 0 ? Math.min(100, (store.totalBytes / store.limitBytes) * 100) : 0;
          return (
            <div key={store.key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{store.key}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{store.canisterId}</p>
                </div>
                {store.error ? (
                  <Badge variant="outline">Unknown</Badge>
                ) : store.accepting ? (
                  <Badge variant="secondary">Accepting photos</Badge>
                ) : (
                  <Badge variant="destructive">Full (read only)</Badge>
                )}
              </div>
              {store.error ? (
                <p className="text-xs text-muted-foreground">{store.error}</p>
              ) : (
                <>
                  <Progress value={pct} />
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(store.totalBytes)} of {formatBytes(store.limitBytes)} ({pct.toFixed(0)}%)
                  </p>
                </>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
