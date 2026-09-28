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
