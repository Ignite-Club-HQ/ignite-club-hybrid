# Standard club-chat repair

## Implementation and local proof

`ensure_default_club_chat` binds each club and explicit standard key to one
conversation. Its account/membership checks finish before a synchronous
lookup/claim/create commit, so independently submitted concurrent updates return
one ID. A new additive migration initializes the binding map without changing
existing conversations, messages, memberships, roles, polls or attachments.

Existing IDs may be adopted only with that chat's existing management permission,
matching club, standard name, group kind and active status. An authoritative
binding overrides a stale proposed duplicate. Reuse never applies proposed
members or owner roles; existing membership updates remain separately authorized.
Deleted bindings return an error and require explicit administrator restore;
they are never automatically restored or replaced. Ordinary custom creation
remains create-only, including same-name chats. No chat/history is deleted.

The updated app uses the acknowledged ID for subsequent membership updates. It
never substitutes the create-only method after a missing-method or uncertain
response. **The canister upgrade must precede publication/native bundle release.**
Older installed native bundles still use the old create-only operation and need
the compatible app update to receive this guarantee.

Real PocketIC evidence (`frontend/scripts/test-default-club-chats-replica.mjs`):
two disposable group instances, original-module-to-candidate upgrade, preserved
message ID, eight overlapping submissions yielding one room, custom same-name
room preserved, wrong scope/caller denied, proposed owner roles not applied on
reuse, deleted room not revived, explicit restore and stable binding/history
readback after a second upgrade. This is local service evidence, not a signed-in
production or native-device acceptance result.

## Exact release

GitHub Actions: **Upgrade chats (both ICP groups)**, action **upgrade**, confirmation
`UPGRADE BOTH GROUPS CHATS`. Check mode is optional; upgrade performs its own
preflight. It builds only the pinned messaging recipe and upgrades exactly:

- Original Group 1: `mx3u5-iqaaa-aaaal-qxlqq-cai`.
- Group 2: `yluv5-wiaaa-aaaal-qxpzq-cai`.

It shares the existing governor deployment lock/environment and uses the existing
`DEPLOYER_PEM`. No new identity, canister, media migration, settings update,
service rewiring, fuel purchase, group opening or broad thirteen-service upgrade.
It verifies registered inventory, sole governor, subnet, fuel, module/settings
hashes and original photo-key receipts. Each upgrade intent is persisted and
read back at its acknowledged immutable commit on `messaging-upgrade-receipts`.
Unknown outcomes stop; exact candidate readback may settle them without reinstall.
Only the G2 messaging fingerprint changes, followed by governor-verified snapshot
refresh. Sync those changes before releasing the compatible app.

## Remaining acceptance

No live upgrade was executed from this sandbox: its governor PEM and GitHub
dispatch credentials are unavailable. After the protected workflow succeeds,
verify the real Group 1/2 standard chats, their preserved history and concurrent
setup on the signed-in account. The remote sandbox cannot obtain that user's
Internet Identity session. Other performance-plan tasks remain separately open.