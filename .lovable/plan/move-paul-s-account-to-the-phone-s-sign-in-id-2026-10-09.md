# Move Paul's account to the phone's sign-in ID

Move everything tied to the old sign-in ID `mbrvi-…-wqe` over to the new one `tavrz-s2z7n-5jkdv-dpho3-pvd3c-yog77-euqar-egkuv-xbzei-ftw3d-eqe`. After the move, every device that signs in to the blockchain copy opens your existing profile with your clubs, chats and admin rights.

## What you'll do afterwards

1. Top up any canister that the update says is low on cycles. The update installs on about 12 canisters, so expect a few top-ups.
2. Run the **blockchain update** on `main`. This adds the account-move feature to each canister.
3. Run the new **"Move account to new sign-in ID"** workflow with the old and new IDs. Leave `confirm` empty first: that's a dry run that lists what would move from each canister. Then run it again with `confirm = yes`.
4. On the laptop, sign out and sign back in. It will then get the new ID too, and land in your profile.
5. Until the move runs, don't fill in the create-profile form on the phone.

## What moves

| Part | Moved |
|---|---|
| Profile and app admin | Your name, photo, roles, terms acceptance and Pro purchases |
| Clubs | Club roles, guardian and child links, club-creator credit, captaincies, role requests, theme choice, fee payments |
| Events | Events you created, RSVPs, attendance marks, duties, guests you added, views |
| Chats | Chat and group memberships, messages you sent, reactions, read and unread status, mutes, pins, poll votes, blocks, DM links |
| Vault | Files and folders you created, access grants |
| Notifications | Push device registrations, notification preferences, scheduled messages you wrote |
| Private names | Names and photos you own or can read (no re-encryption needed, only the access lists change) |
| Photos | Uploads you own |
| Mini leagues, competitions, club points, insights | Roles and anything you created |

## Safety rules

- Only the governor (the deploy account) can run a move.
- The move is refused if the new sign-in ID already has a profile or any club, chat or event data. It may only have the empty account created at sign-in.
- Running it twice does nothing the second time, because the old ID has nothing left to move.
- The dry run shows how many records each canister would change before anything is written.
- The unused second profile `qetxl…dae` is left alone. It can be removed afterwards with the existing duplicate-removal workflow if you want.

## Technical details

- Each canister gets a new governor-only update method `rekey_principal(old : principal, new : principal, dry_run : bool) -> Result<nat, text>`. It returns the number of records changed. No new stored state, so no migration files are needed.
- Each method rewrites every stored `Principal` equal to `old`, plus every text id derived from it: `Principal.toText(old)` and club_domain's `"principal:" # toText(old)` provisional account id. This covers keys, values, and arrays such as `participants`, `members`, `readers` and `bulkAccessPrincipals`.
- identity_access (Rust): erase the new ID's empty account, then link the new principal to the old account. This keeps the same `account_id`, so the profile, roles, families, consents and terms follow automatically. Unlink and de-index the old principal, and rewrite the principal-keyed entitlements.
- club_domain local `Account.principals`/`legacy_subject`: the old principal is swapped in place.
- pii_access_control: swap `domain_owner`, `readers` and `GuardianRelationship.guardian`. The ciphertext is keyed to (pii_id, field), so it stays readable. Clear the vetKey cache by signing out.
- media_blob_store: swap the `owner` on blobs and upload sessions.
- Canisters covered: identity_access, club_domain, events_domain, messaging_domain, vault_domain, notification_queue, pii_access_control, media_blob_store, media_metadata, mini_league_domain, competition_domain, club_points_domain, insights_domain.
- `scripts/move-account.mjs` plus `.github/workflows/move-account.yml` (inputs: `old_principal`, `new_principal`, `confirm`; uses DEPLOYER_PEM). The order is the domain canisters first and identity_access last, so a partial failure can be re-run safely.
- Every canister is compile-checked with moc 1.16.1 or cargo. The .did files and frontend bindings are regenerated and the candid drift check is run.
- A rule is recorded in `backend/AGENTS.md`: any new stored principal field must be added to that canister's `rekey_principal`.
