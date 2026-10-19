# Account-removal release gates

## Verified locally in the current batch

- Durable club receipts reject old linked-account snapshots even when sync starts after removal or after an upgrade.
- Contradictory same-version snapshots are refused. A strictly newer explicit relink remains possible without resurrecting deleted roles.
- Unlink intents freeze exact authority targets before the first external call; foreign acknowledgements and incomplete target sets cannot complete removal.
- Legacy pending records migrate using the prior implementation's persisted inventory, which could not change while recovery was pending. Invalid historical inventories reject upgrade.
- Consensus registry evidence validates revision, complete domain/placement sets, deployment, host, network, subnet approvals and required original authorities. Verified wiring is local-only and rechecks the registry between setters.
- Two-real-group PocketIC checks cover stopped authority, suspended sync, receiver and identity upgrades, recovery, surviving identities, newer relinks, old receipt replay and concurrent unlink requests.

## Not released

The above is recovery correctness, **not authority-wide revocation**. Identity removal is still local-rehearsal-only, frontend membership paging does not call prototype sync, deploy scripts do not wire it, and new-group activation remains blocked.

## Remaining engineering

1. Persist authoritative principal-denial generations before external removal work. Retain tombstones after unlink/erasure so registration cannot regain obsolete grants.
2. Enforce principal eligibility before every resource-permission alternative across all club/group/media services. Eligibility denies or permits evaluating existing permissions; it never grants a role.
3. Handle ordinary query, composite-query and update boundaries explicitly. Consensus identity checks cannot be hidden inside a synchronous helper or called as an update from a composite query. Preserve equivalent single/batch/discovery behavior.
4. Revalidate after awaits and define a drain/ack barrier for already-authorized in-flight operations. A remote check followed by a local commit is not atomic global revocation.
5. Invalidate roles, creator/admin/claimant shortcuts, private-file owners/readers, queued authors/recipients, device delivery, pending uploads, invitation replay, imports and rekeys at the appropriate generation. Keep shared historical records and surviving identities intact.
6. Bind removal to a complete server-verified deployment inventory, including original/shared groups and additional media authorities; every target must acknowledge before completion. Frontend validation alone is not that proof.
7. Test a restarted but unacknowledged group **before retrying unlink**: private reads, writes, delegated access and key issuance must already deny. Cover authority outages, all alternative grants, delayed replies, lost acknowledgements, concurrent retries, upgrades and relinks.
8. Only after these pass: signed-in hosted and native acceptance, followed by separately approved deployment/activation.

Previously downloaded plaintext, already issued keys and delivered notifications cannot be recalled; tests must distinguish future access denial from retroactive cryptographic revocation.

Encrypted-media clubs remain immovable under the current owner policy. No routing activation or deployment is authorized by these results.