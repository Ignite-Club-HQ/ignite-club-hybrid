#!/usr/bin/env bun
/**
 * migrate-media-to-blob-store — moves existing gallery photos from Supabase
 * storage to the ICP media_blob_store canister and records each blob_ref on
 * the media_metadata canister.
 *
 * Written against the fixed contract (backend/media_blob_store/media_blob_store.did);
 * run it once the blob-store canister is deployed. Safe to re-run: photos whose
 * image_url already points at the canister are skipped, and photos without a
 * matching media_metadata asset still get their bytes uploaded + row updated.
 *
 * Usage (from the repo root, bun resolves the frontend's dependencies):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   MEDIA_BLOB_STORE_CANISTER_ID=... IC_IDENTITY_PEM=/path/to/identity.pem \
 *   bun frontend/scripts/migrate-media-to-blob-store.mjs [--dry-run] [--limit N] [--club <clubId>]
 *
 * Optional env:
 *   MEDIA_METADATA_CANISTER_ID  — also set blob_ref on matching canister assets
 *   IC_HOST                     — defaults to https://icp-api.io
 *   IC_FETCH_ROOT_KEY=1         — only for local replica testing
 *
 * The service-role key is required to read every club's photos; it is used
 * only inside this operator-run script and never shipped to the browser.
 */

import { createClient } from "@supabase/supabase-js";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { Principal } from "@icp-sdk/core/principal";
import { readFileSync } from "node:fs";
import {
  BLOB_CHUNK_SIZE,
  chunkBytes,
  chunkCountFor,
  sha256Hex,
  storagePathFromPublicUrl,
} from "../src/live/blobStoreProtocol.ts";
import { idlFactory as blobStoreIdl } from "../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js";
import { idlFactory as mediaMetadataIdl } from "../src/lab/bindings/media_metadata/declarations/media_metadata.did.js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitFlag = args.indexOf("--limit");
const LIMIT = limitFlag !== -1 ? Number.parseInt(args[limitFlag + 1], 10) : Infinity;
const clubFlag = args.indexOf("--club");
const CLUB = clubFlag !== -1 ? args[clubFlag + 1] : null;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
  return value;
}

function unwrap(result, label) {
  if ("Err" in result) throw new Error(`${label} failed: ${result.Err}`);
  return result.Ok;
}

async function loadIdentity(pemPath) {
  const pem = readFileSync(pemPath, "utf8");
  const { Ed25519KeyIdentity, Secp256k1KeyIdentity } = await import("@icp-sdk/core/identity");
  try {
    return Ed25519KeyIdentity.fromPem(pem);
  } catch {
    return Secp256k1KeyIdentity.fromPem(pem);
  }
}

async function main() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const blobStoreCanisterId = requireEnv("MEDIA_BLOB_STORE_CANISTER_ID");
  const pemPath = requireEnv("IC_IDENTITY_PEM");
  const mediaMetadataCanisterId = process.env.MEDIA_METADATA_CANISTER_ID || null;
  const host = process.env.IC_HOST || "https://icp-api.io";

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const identity = await loadIdentity(pemPath);
  console.log(`Identity principal: ${identity.getPrincipal().toText()}`);
  const agent = new HttpAgent({ host, identity });
  if (process.env.IC_FETCH_ROOT_KEY === "1") await agent.fetchRootKey();

  const blobStore = Actor.createActor(blobStoreIdl, {
    agent,
    canisterId: Principal.fromText(blobStoreCanisterId),
  });
  const mediaMetadata = mediaMetadataCanisterId
    ? Actor.createActor(mediaMetadataIdl, { agent, canisterId: Principal.fromText(mediaMetadataCanisterId) })
    : null;

  if (!DRY_RUN) {
    const health = await blobStore.health();
    console.log(`Blob store reachable: v${health.version}, ${health.blob_count} blobs, ${health.total_bytes} bytes`);
  }

  // Gallery photos still served from Supabase storage.
  let query = supabase
    .from("photos")
    .select("id, club_id, image_url")
    .like("image_url", "%/storage/v1/object/public/photos/%")
    .order("id");
  if (CLUB) query = query.eq("club_id", CLUB);
  const { data: photos, error } = await query;
  if (error) throw error;

  const targets = (photos || []).slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
  console.log(`${targets.length} photo(s) to migrate${DRY_RUN ? " (dry run — no writes)" : ""}.`);

  let migrated = 0;
  let failed = 0;
  for (const photo of targets) {
    const storagePath = storagePathFromPublicUrl(photo.image_url, "photos");
    if (!storagePath) {
      console.warn(`SKIP ${photo.id}: cannot parse storage path from ${photo.image_url}`);
      continue;
    }
    try {
      if (DRY_RUN) {
        console.log(`DRY ${photo.id}: ${storagePath}`);
        continue;
      }

      const { data: blob, error: downloadError } = await supabase.storage.from("photos").download(storagePath);
      if (downloadError) throw downloadError;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const contentHash = await sha256Hex(bytes);

      // Chunked upload per the fixed contract.
      const uploadId = unwrap(
        await blobStore.begin_upload(storagePath, "application/octet-stream", BigInt(bytes.length), chunkCountFor(bytes.length)),
        "begin_upload",
      );
      try {
        const chunks = chunkBytes(bytes, BLOB_CHUNK_SIZE);
        for (let index = 0; index < chunks.length; index++) {
          unwrap(await blobStore.put_chunk(uploadId, index, chunks[index]), `put_chunk ${index}`);
        }
      } catch (uploadError) {
        try { await blobStore.abort_upload(uploadId); } catch {}
        throw uploadError;
      }
      const finalized = unwrap(await blobStore.finalize_upload(uploadId), "finalize_upload");
      if (finalized.content_hash !== contentHash) {
        throw new Error(`hash mismatch for ${storagePath}: canister ${finalized.content_hash}, local ${contentHash}`);
      }

      const onChainUrl = `https://${blobStoreCanisterId}.icp0.io/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
      const { error: updateError } = await supabase
        .from("photos")
        .update({ image_url: onChainUrl })
        .eq("id", photo.id);
      if (updateError) throw updateError;

      // Record the pointer on the media_metadata asset when one exists.
      if (mediaMetadata && photo.club_id) {
        const assets = await mediaMetadata.list_assets(photo.club_id);
        const asset = assets.find((a) => a.storage_path === storagePath);
        if (asset) {
          unwrap(
            await mediaMetadata.set_blob_ref(asset.id, [
              { canister: blobStoreCanisterId, path: storagePath, content_hash: contentHash },
            ]),
            "set_blob_ref",
          );
        }
      }

      migrated++;
      console.log(`OK   ${photo.id}: ${storagePath} (${bytes.length} bytes, sha256 ${contentHash.slice(0, 12)}…)`);
    } catch (photoError) {
      failed++;
      console.error(`FAIL ${photo.id}: ${storagePath}: ${photoError.message}`);
    }
  }

  console.log(`Done. migrated=${migrated} failed=${failed} skipped=${targets.length - migrated - failed}`);
  if (failed > 0) process.exit(2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
