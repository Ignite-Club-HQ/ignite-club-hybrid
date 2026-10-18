# Ignite ICP MCP Layer 4

Implemented scope: read-only `schema()` and `execute(text)` query methods on `club_domain` and `events_domain`. No new backend, frontend page, authentication provider, or persistent state. Existing Candid methods remain available for messaging, fixtures, administration and writes; they have not all received an OQL catalogue.

## Protocol

Reference: https://skills.internetcomputer.org/.well-known/skills/service-discoverability/SKILL.md (reviewed 2026-10-18). The official convention specifies a JSON catalogue, a JSON query request, and named Candid cells returned as `{ hasMore : bool; rows : vec vec Cell }`. It does not fix the JSON grammar. Ignite publishes its `ignite-readonly-oql` grammar, supported fields, restrictions and examples in each `schema()` response. Cells use text/int/bool/null_ tags; optional fields are null_, not empty strings. Unsupported requests trap, never silently widen the query.

Example first query on club_domain:

```json
{"entity":"clubs","select":["id","name"],"limit":50}
```

Then events_domain (replace IDs and the example time with real values):

```json
{"entity":"events","select":["id","title","team_id","starts_at_ms","location"],"filters":[{"field":"club_id","op":"eq","value":"<returned club id>"},{"field":"starts_at_ms","op":"gte","value":1792285200000},{"field":"cancelled","op":"eq","value":false}],"orderBy":{"field":"starts_at_ms","direction":"asc"},"limit":50,"offset":0}
```

Count per caller-visible team:

```json
{"entity":"events","aggregate":"count","groupBy":"team_id"}
```

Filters are ANDed; supported operators are eq/ne/gt/gte/lt/lte/contains (case-sensitive). Types must match. Boolean/null values only support eq/ne. No joins, arbitrary expressions, mutation, or PII decryption. Paging is live, not snapshot-isolated: advance offset by the number of returned rows while hasMore is true; concurrent writes can change pages. Read cells by name. Bounds: 8192 characters, nesting 8, filters 12, limit 1–100, offset ≤10000, source ≤50000 rows, matches ≤10000, groups ≤1000. Broad requests exceeding limits fail; use narrower filters or existing domain APIs.

## Permissions

- Anonymous execute calls are rejected. schema is public metadata only.
- Events reuse the *same* canView helper as existing event queries: governor, creator, or stored club role; deleted events are excluded. This preserves existing semantics, including the existing local role mirror. OQL does not create a fresh cross-canister membership check or fix stale/missing mirrored roles. Validate revocation and ordinary-member visibility after deployment.
- Clubs and teams apply existing isMember/isAdmin checks, including existing family/exclusion handling; soft-deleted rows are excluded.
- Authorization runs before filtering, projection, aggregation and paging; hidden rows never contribute to counts or hasMore. User-supplied IDs are filters, not authority.
- No private contact details, shell claim tokens, principal fields, child data, notes, media ciphertext or Supabase records are included in the OQL schema. Existing non-OQL methods keep their existing permissions; this change is not a global security audit.

## Release and proof

1. Upgrade club_domain and events_domain with the existing mainnet deployment workflow, preserving installed state/governor. No migration or extra wiring is needed for OQL. If the earlier MCP changes are not deployed, also deploy notification_queue and the frontend, including identity-access wiring.
2. Verify deployed candid:service contains `schema : () -> (text) query` and `execute : (text) -> (Result) query` and that the frontend manifest declares both canisters. Local regeneration proves the source interface, not the installed Wasm.
3. In ChatGPT's Internet Computer connector, open the application's canonical frontend canister URL and authorize Internet Identity with Questions only. Fetch both schemas; ask for your clubs, then upcoming events, using the actual current Unix milliseconds.
4. Compare results with the app for the same principal; exercise paging and count/groupBy. Use another club ID as a filter: no hidden data or counts. Repeat with an unrelated identity and after membership revocation; check ordinary-member and linked-account access. Attempt a write in Questions only and verify delegation rejects it.
5. Live ChatGPT/Internet Identity verification is not possible from repository tests alone and must be performed after upgrades. No deployment was performed as part of this implementation.

Local checks:

```sh
# Run from each respective canister directory:
moc $(mops sources) -r test/oql.test.mo
# Root:
python3 backend/shared/test/oql_rejections.py
node frontend/scripts/check-candid-drift.mjs
```

Publishing the existing manifest opts the operator into DFINITY's ICP MCP App Operator Terms; confirm authorized operator acceptance of the current version before publishing: https://internetcomputer.org/icp-mcp/app-operator-terms/ . This Layer 4 implementation does not itself publish or modify the manifest.
