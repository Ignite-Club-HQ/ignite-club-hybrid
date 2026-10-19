import { writeOnce } from "@/live/clubScope";
import { withFeatureBackend } from "@/live/featureRouter";
import { tryUploadMediaToBlobStore } from "@/live/mediaUpload";
import { makeVaultFileToken } from "@/lib/chatVaultLinks";

/** Register encrypted chat documents before exposing a shareable token. */
export async function uploadIcpChatDocument(file: File, clubId: string, teamId?: string): Promise<string> {
  if (!clubId) throw new Error("Choose a club before attaching a file");
  const id = crypto.randomUUID();
  const extension = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const mime = file.type || "application/octet-stream";
  return withFeatureBackend("vault", {
    supabase: () => { throw new Error("File sharing could not connect to ICP. Please try again."); },
    icp: async (ctx) => {
      const uploaded = await tryUploadMediaToBlobStore({
        storagePath: `clubs/${clubId}/chat/files/${id}.${extension}`,
        file,
        mime,
        lock: "own",
      });
      if (!uploaded) throw new Error("File upload could not connect to ICP storage. Please try again.");
      const { registerLiveVaultFile } = await import("@/live/features/vault");
      await registerLiveVaultFile(ctx, id, "", clubId, teamId ?? null, file.name, uploaded.url, file.size, mime, false, uploaded.blobRef);
      return makeVaultFileToken(id);
    },
  }, writeOnce({ clubId }));
}