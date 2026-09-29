# ICP Deployment Runbook

How to take Ignite Club HQ from Supabase-only to the hybrid Supabase + ICP
backend, step by step. Everything is reversible until the final cutover, and
every feature falls back to Supabase until its canister ID is configured.

## 0. Before you start

- `dfx` installed and a cycles wallet funded (mainnet deploys need cycles).
- The canister source under `backend/` (one folder per canister).
- App-admin access to the app (for `/admin/placement-settings`).
- Optional but recommended: deploy to a local replica or the playground first
  (`dfx deploy --playground`) to smoke-test the canister code itself.

## 1. Deploy the canisters

From the canister code repo, deploy each canister and record its ID:

```bash
dfx deploy <canister_name> --network ic
dfx canister id <canister_name> --network ic
```

The 14 backend canisters (keys the app understands), in suggested deploy order:

| Key | Role | App features that use it |
|---|---|---|
| `placement_registry` | Control plane | infrastructure only |
| `shard_router` | Control plane | infrastructure only |
| `migration_coordinator` | Control plane | infrastructure only |
| `identity_access` | Domain | sign-in / Internet Identity |
| `pii_access_control` | Domain | encrypted PII records |
| `vault_domain` | Domain | vault folders, files, trash |
| `club_domain` | Domain | club news, membership (role roster) |
| `events_domain` | Domain | events, RSVPs, home schedule |
| `competition_domain` | Domain | competitions |
| `messaging_domain` | Domain | group messages |
| `media_metadata` | Domain | media feed, reactions, comments |
| `media_blob_store` | Domain (future) | on-chain media bytes — optional, see §6 |
| `notification_queue` | Worker | notifications inbox |
| `timer_jobs` | Worker | infrastructure only |
| `secret_workload_identity` | Worker | infrastructure only |

Plus `internet_identity_frontend` — the Internet Identity asset canister used
for passkey sign-in.

You do NOT need all of them. A feature switches to ICP only when its own
canister ID is configured, so you can deploy and adopt incrementally (e.g.
start with `identity_access` + `events_domain`).

## 2. Register the canister IDs

In the app, as an app admin:

1. Open **Infrastructure / Placement Settings** (`/admin/placement-settings`).
2. In **Canister configuration**, add one row per deployed canister:
   Key (suggestions list all 14 known keys) -> Canister ID.
3. Save. Values take effect immediately, for every session, and override the
   build-time defaults key-by-key.

Alternative (build-time defaults): set `IGNITE_LIVE_ICP_CANISTER_IDS_JSON`
to a JSON object of `{ "key": "canister-id" }` before building.

## 3. Choose the routing rules

Still on Placement Settings:

- **Default backend**: leave Supabase while testing; switch to
  Internet Computer (ICP) when ready for ICP to serve eligible countries.
- **Country eligibility**: restrict countries to Supabase only / ICP only /
  both. A country pinned to ICP only falls back to Supabase for any feature
  whose canister is not yet configured — it can never break the app.
- **Approved targets**: optionally pin a country to a specific
  deployment (region / cloud engine / version).

## 4. Verify

1. **Dry run first**: on Placement Settings, open **Dry run: preview ICP
   routing** and toggle the simulation. It shows, per feature area, the
   backend in use now and the backend that would be used once canisters are
   configured — including what the sign-in screen will show. Use this to
   sanity-check your routing rules before and after entering real IDs.
2. Check the **Status** card: your country, effective backend, effective
   target.
3. Sign out and open `/auth`: when ICP is the effective backend and at least
   one canister ID is configured, the Internet Identity sign-in screen
   appears; otherwise Supabase sign-in.
4. Sign in with Internet Identity and exercise each ICP-routed feature:
   events + RSVPs, home schedule, media feed (reactions/comments), group
   messages, club news.
5. Watch for degraded rendering: several canister record shapes lack fields
   the UI expects (message timestamps, joined club/team names, multi-post
   news). These are provisional mappings — confirm the real canister
   responses and extend the canister APIs or the mappers in
   `frontend/src/live/features/` where they diverge.

## 5. Rollback (any time)

- Remove a canister's row in Canister configuration -> that feature returns
  to Supabase on next config load.
- Or switch the default backend back to Supabase / set the country to
  Supabase only.
- Nothing is deleted: Supabase data written before cutover is untouched, and
  ICP-directed writes never silently divert to Supabase (they fail loudly
  instead, so a misconfiguration is visible rather than corrupting data).

## 6. Optional: move media bytes on-chain later

Media *files* stay in Supabase storage by default; only metadata lives on
`media_metadata`. The future-proofing for on-chain blobs is already in place:

- Every canister asset carries an optional `blob_ref` pointer
  (blob-store canister ID + path + SHA-256 content hash); `set_blob_ref`
  attaches it after upload. Assets without it keep resolving to Supabase.
- The frontend resolves an asset's bytes through
  `frontend/src/live/mediaStorage.ts` (`resolveMediaSource` /
  `liveAssetSource`), so feature code never hardcodes a storage backend.
- `media_blob_store` is already a known key in Placement Settings.

Everything except the canister itself is already built:

- The contract is fixed at `backend/media_blob_store/media_blob_store.did`
  (chunked `begin_upload`/`put_chunk`/`finalize_upload`/`abort_upload`,
  `http_request` serving at `https://<canister-id>.icp0.io/<path>`,
  `get_content_hash`, `health`); frontend bindings live under
  `frontend/src/lab/bindings/media_blob_store/declarations/` and the protocol
  is pinned by `frontend/src/live/blobStoreProtocol.test.ts`.
- Uploads already route through `frontend/src/live/mediaUpload.ts`
  (`tryUploadMediaToBlobStore`): gallery photo and vault uploads check the
  `media_blob_store` setting and go on-chain once an ID is registered AND the
  member is signed in with Internet Identity; until then Supabase storage
  runs unchanged. A configured-but-failed upload throws rather than silently
  diverting to Supabase.
- `frontend/scripts/migrate-media-to-blob-store.mjs` (run with bun) moves existing
  Supabase photos on-chain: downloads, SHA-256s, chunked-uploads, rewrites
  the photo row's URL, and calls `set_blob_ref` on the matching
  `media_metadata` asset. Supports `--dry-run`, `--limit`, `--club`; safe to
  re-run. Test it free on the ICP playground before mainnet.

To adopt: implement the canister against the fixed .did, deploy it, paste its
ID under the `media_blob_store` key — uploads switch automatically. Then run
the migration script for existing media if desired; untouched assets keep
working from Supabase storage.

## Known gaps at time of writing

- Not yet wired to live reads: membership, competitions, notifications,
  vault — their canisters expose governance/worker-facing operations that
  don't yet match the app's browser read paths. Service modules are ready
  in `frontend/src/live/features/`.
- End-to-end verification requires deployed canisters and an Internet
  Identity sign-in; the dry-run preview is the pre-deployment check.
