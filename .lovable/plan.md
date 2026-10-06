# Per-club photo lock

Today every photo has its own lock, and opening each one costs a slow, paid key request. With this change, each club's photos share one club lock. A member gets that club's key once per app session, and every photo in the club then unlocks instantly on the phone.

## What you'll notice

1. **Feeds and chats load fast.** The first photo in a club waits a few seconds. After that, photos load about as fast as normal images.
2. **About 100 times cheaper.** You pay one unlock per member, per club, per session, instead of one per photo.
3. **Still members-only.** The club key is only given to people the club records confirm as members of that club.
4. **Old photos keep working.** Photos uploaded before the change keep their own lock and still open the old way. An optional one-off "re-lock old photos" button in Placement Settings moves them to the club lock.
5. **Personal photos stay on their own lock.** Profile photos and anything not tied to a club work as they do now.

## Order of work

1. Canister: let confirmed club members, not just staff, get the club photo key.
2. App: lock new club photos (gallery, news, team, club and group chats, vault) with the club lock.
3. App: remember each club key in memory for the session, and unlock photos on the phone.
4. App: open older photos the old way automatically.
5. Optional: a re-lock button for older photos (admin only).
6. Deploy the photo-access and club canisters, then publish.

## Limits

- Needs a mainnet deploy of the photo-access canister, so it must be topped up first.
- Someone removed from a club can still open photos from that session until they close the app. Each new session checks membership again.
- The key is only kept in memory, so it's fetched once again after every app restart.

## Technical details

- **Identity:** the club media IBE identity is `clubmedia:<clubId>` + U+001F + `blob`. Upload encrypts to it under the existing pii_access_control derived public key. No per-photo pii record is registered for club photos.
- **pii_access_control:** a new later-timestamped migration adds `club_member_read_grants`. `can_read` allows `pii_id = "clubmedia:<clubId>"` when `club_domain.is_club_member(caller, clubId)` is true. It creates the per-club record lazily: `ensure_club_media_record(clubId)`, which is staff-only or happens on the first upload by a member. Keep the existing staff grant path unchanged. Purge also revokes the club media grant.
- **club_domain:** add the `is_club_member(principal, clubId)` query if no equivalent exists. Check the existing membership helpers first.
- **Blob refs:** a versioned marker in the stored path or ref (e.g. a `cm1/` segment under `clubs/<clubId>/`) tells `mediaDecrypt.ts` which identity to use. Paths without the marker use the legacy per-photo identity.
- **Frontend:** `mediaUpload.ts`/`blobStoreUpload.ts` choose the club identity whenever a club id is known. A new `clubMediaKeys.ts` session cache holds `Map<clubId, Promise<VetKey>>` (in-flight dedupe, cleared on sign-out). `mediaDecrypt.ts` decrypts locally with the cached key. Upload paths for chats, news, gallery and vault pass the club id through.
- **Re-lock (optional):** an admin action downloads each legacy blob, decrypts it, re-encrypts it to the club identity, uploads it to a new path and updates the metadata ref. It runs in batches with progress, and legacy blobs are deleted only after success.
- **Process:** `.did` regeneration, bindings for both `frontend/src/lab` folders, drift check, unit tests for the identity choice and key cache, and updates to `frontend/AGENTS.md` and `backend/AGENTS.md`.
