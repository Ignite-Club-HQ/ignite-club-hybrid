# Motoko migration coordinator

This is a local synthetic control-plane canister for mixed Rust/Motoko deployments.
The domain canisters (Motoko: club_domain, events_domain, competition_domain,
messaging_domain, media_metadata, pii_access_control) remain the data owners.
The coordinator stores only durable migration evidence: source and destination
canister IDs, domain, schema version, record count, checksum, and phase.

A migration must advance in order:

`started -> exported -> imported -> verified -> committed`

An active migration can be aborted. Routing changes belong to the Rust control
plane (placement_registry, shard_router) and must occur only after `verify`;
this canister never copies domain data or stores production credentials.

## Canister-driven orchestration (target design)

Today an external operator drives the phase transitions by calling
`begin / markExported / markImported / verify / commit` and performs the actual
data copy off-chain. Once the domain canisters are deployed, orchestration can
move on-chain so no single operator key controls the flow:

1. `begin(domain, source, destination, schemaVersion, checksum)` — the
   coordinator records intent and calls `source.export_state()` itself. The
   domain canister only answers export calls from the coordinator principal
   (governor allowlist), so evidence and data cannot diverge.
2. Export — the coordinator (or a timer_jobs scheduled job) pages
   `export_state` from the source and calls `import_state` on the destination.
   Each page advances the stored record count; `markExported` is emitted by
   the coordinator only when the page stream completes, never by a caller.
3. Verify — the coordinator calls `reconcile(snapshot)` on both canisters and
   compares record counts and checksums against what it stored. Matching
   results advance the migration to `verified`; a mismatch aborts it.
4. Commit — only after `verified` does the coordinator notify
   `placement_registry` / `shard_router` to flip routing for that domain.
   Routing never changes before `verify`, and abort leaves routing untouched.
5. Abort — at any phase before `committed`, `abort` clears in-flight state
   and the destination canister discards the partial import.

Key properties: the coordinator is the only principal the domain canisters
accept bulk export/import from; phase transitions are computed, not asserted
by callers; and the Rust control plane remains the sole writer of routing
changes, preserving the trust boundary above.

## Implemented orchestration (current state)

The first two steps of the target design are now live:

- `orchestrateExport(id)` — the coordinator calls `export_state()` on the
  source and destination domain canisters itself (inter-canister call, using
  structurally-typed actor interfaces declared locally). Domain canisters
  answer `export_state` only for their governor or a principal on their
  `bulkAccessPrincipals` allowlist — register the coordinator there via the
  governor-only `addBulkAccessPrincipal` / `removeBulkAccessPrincipal` /
  `listBulkAccessPrincipals` methods on events_domain, competition_domain,
  media_metadata, and messaging_domain. On success the migration advances to
  `exported` with the computed evidence; a failed call traps and leaves the
  phase unchanged.
- `orchestrateVerify(id)` — the coordinator re-reads both canisters and
  compares record counts and checksums. Matching evidence advances the
  migration to `verified`; a mismatch aborts it.

Checksum tradeoff: because each domain canister's `export_state` returns a
different record shape, the checksum is a hand-rolled FNV-1a hash over a
deterministic text built from the schema version, governor, and per-collection
sizes. It covers shape and counts, not full byte content — sufficient to catch
divergent exports, not a cryptographic content proof.

Known gaps, still operator-driven or missing:

- Domain canisters do not yet expose `import_state` or `reconcile`, so the
  actual data copy (step 2) and on-chain reconcile (step 3) remain external;
  `markExported` / `markImported` / `verify` / `commit` stay available for
  that operator-driven path.
- club_domain has no `export_state` at all and cannot be orchestrated yet.
- identity_access (Rust) has `export_state` only and is not yet wired into
  orchestration.
