# ICP gallery completion — 24 October 2026

## Implemented

- Gallery replies retain exact parent IDs; comments/reactions queue notices through configured club authority, with server-derived recipients and no browser fan-out.
- Exact photo/comment/event/team/card links use authorized media reads, including card assets outside the first feed page. Ongoing refresh remains quiet and preserves loaded photos.
- Sharing uses authoritative exact club/team premium allowances; staff moderation stays scoped to the asset club/team. Feed-only removal hides public gallery APIs while retaining its independent authorized Vault copy; feed-and-Vault removal trashes both metadata records.
- Gallery mirrors upload separate per-file encrypted bytes, check premium scope and source/store hash readback, deduplicate by source and recheck authority/access after awaits. Raw URL-only ICP mirrors are refused.
- Gallery view writes/reads use media_metadata, not Supabase or unrestricted analytics aggregates. Anonymous/foreign/hidden asset access is denied.
- Team-upload cards validate exact owned assets, persist a stable receipt, then use existing authorized messaging sends. Batch chat-photo publishing uses an ICP album ID and decrypted independent gallery copies; failures are counted accurately.
- Uploads stay successful when optional Vault copies, notices or chat announcements fail; uploader feedback names the unconfirmed secondary action.

## Verification

Changed media, club, Vault and notification canisters compile. Focused dual-mode frontend, generated-Candid and ICP-isolation checks pass. Disposable real canister scenario covers reply parents/foreign denial, notice inbox/dedup, private-copy scope/store/hash refusal, view counts/foreign denial, card ownership/scope/receipt, hidden gallery reads and upgrade retention. This is local evidence, not signed-in mainnet acceptance.

## Release prerequisites

Nothing deployed. Upgrade only existing media_metadata, vault_domain, club_domain and notification_queue in both registered groups using a separately protected exact-target release, preserving memory, live settings, photo authorities and journal intent/readback. The metadata-only photo-paging workflow does not cover this larger scope; do not use it as a substitute or run a broad all-service upgrade.

Configure each group's media_metadata.set_gallery_authorities(club_domain, vault_domain), club_domain.set_gallery_media_authority(media_metadata), and vault_domain.set_gallery_media_authority(media_metadata), retaining club/queue bindings. New-group configuration and mainnet wiring contain these calls; existing groups still require protected upgrades and verified wiring/readback, refreshed routing evidence and a compatible app release.

Verify with a signed-in Internet Identity account: upload a multi-photo team album, read it back, open its chat card, reply/react, view counts, report/block, share, inspect the separate Vault copy, and exercise both deletion choices. No usable signed-in II session is available in this sandbox. Phone push transport and device encryption/caching remain outside consensus by design; gallery records, moderation reports and inbox notices are on-chain.
