# Motoko migration coordinator

This is a local synthetic control-plane canister for mixed Rust/Motoko deployments.
Rust domain canisters remain the data owners. The coordinator stores only durable
migration evidence: source and destination canister IDs, domain, schema version,
record count, checksum, and phase.

A migration must advance in order:

`started -> exported -> imported -> verified -> committed`

An active migration can be aborted. Routing changes belong to the Rust control
plane and must occur only after `verify`; this canister never copies domain data
or stores production credentials.
