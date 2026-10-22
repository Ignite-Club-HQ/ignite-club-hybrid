# One-click "Add a new group" workflow

Note: the code only contains Group 2 (g2); there is no Group 3 record yet. This plan is built from every failure reported while bringing Group 2 online. That group needed more than 25 GitHub runs across 8 workflows.

## What went wrong (failures reported)

| # | Failure | Root cause | Fixed by the new design |
|---|---|---|---|
| 1 | Install stopped on missing notification worker secret | Secret only checked mid-run | Checked before anything runs |
| 2 | Confirmation rejected (trailing space, missing "S") | Long phrases typed on a phone | One short phrase, trimmed |
| 3 | Build output not found (ICP CLI 1.7.0) | Separate build/stage step | One build step, tested |
| 4 | Card top-up rejected ("g2_topup" underscore), $7.66 bought too little fuel, "no payment link" | Manual payment IDs and fuel guesses | Automatic IDs, quote with margin, fuel checked first |
| 5 | Club service below 1T fuel before upgrade | No fuel check up front | Every service topped up before installing |
| 6 | Register failed: 4 GB memory budget over the router limit | Hand-written approval file | Values come from router rules |
| 7 | Settings failed: "Unknown group id g2" | Wrong order (settings before register) | Fixed order, run automatically |
| 8 | Settings script crashed (duplicate variable) | Untested script path | Whole run tested on a local replica |
| 9 | Settings saved but not loaded; link rejected | Missing reload step | Reload is part of the run |
| 10 | prepare-hashes green but nothing saved (git add of a missing file) | Fragile save step | One save at the end, verified |
| 11 | Progress save failed after 11 reloads (stale branch read) | Read-after-write on GitHub | Journal on a dedicated branch with retries |
| 12 | Check failed: "Deletion registry not pinned", account links missing | Wiring done by a separate repair | Wiring is part of the run |
| 13 | Snapshot hash mismatch (big number format) | Untested format path | Covered by replica test |
| 14 | Club creation: "older registry revision" | New clubs invalidated approval | Already fixed; kept |
| 15 | Club creation: wrong deployment name | Frontend vs router alias | Already fixed; kept |
| 16 | Club creation: account admission denied (IC0406) | Account access not granted to the new group | Granted during the run |
| 17 | "No healthy group with capacity" | Health reading stale | Already fixed (router checks itself); first reading taken during the run |
| 18 | Photo store only 16 GB | Old install default | Already fixed (200 GB from the start); verified at the end |
| 19 | Clubs page empty after opening | New group's protected reads | Already fixed; verified at the end |
| 20 | Upgrade refused while the group was open; every step needed an app publish | Group-2-only scripts and baked-in approval | Generic upgrade; approval read live (see below) |

## The new flow

```text
Run "Add new group"  ->  type ADD GROUP  ->  approve once  ->  done
```

One workflow, two inputs:
- **Group** (filled in automatically with the next free number, e.g. g3)
- **Confirmation**: `ADD GROUP`

It runs these stages in order, stopping safely at the first problem with a plain-English reason:

1. **Preflight (nothing spent):** secrets present, deploy key is the governor, router and identity reachable, enough fuel for all 13 services plus margin. If fuel is short, it reports the exact amount and a ready payment link, then stops.
2. **Build and test:** builds the 13 services once and runs the safety tests on a local replica of the full flow.
3. **Create and install:** creates the 13 services on the chosen subnet with a 200 GB photo store and tops each one up.
4. **Configure:** settings, reload, notification worker grant.
5. **Register closed:** memory budget, club limit and fuel minimum taken from router rules.
6. **Account access:** grants the new group's services account access and pins the deletion registry. This was the separate repair workflow.
7. **Verify:** records module fingerprints, takes the first health reading and runs the full read-only check.
8. **Open:** opens the group to new clubs and records the approval on-chain.
9. **Prove it works:** reads back the group through the same path the app uses, confirms the 200 GB store, health and account access, then writes a summary.
10. **Save once:** commits the group's records in a single verified save.

**Re-running is safe.** Each stage records its result. A re-run skips finished stages and resumes where it stopped. It never repeats a spend or install whose outcome is unknown; it checks the live state first.

**One approval.** The single GitHub admin approval covers the whole run.

## Key design change: no app publish needed after opening

Today the app carries a copy of the approval inside its code, so every approval change needs a new publish. Instead, the router will store the governor-signed approval. The app will check the live group list against it on every check, with the same fail-closed rules. Only the governor can write that approval, so safety stays the same and the publish step goes away.

## Workflows after the change

- **Keep:** Add new group (new), Stop new clubs in a group (generic version of the admin stop), Upgrade groups (generic, works on open groups), Report group health (backup), fuel/card funding, Group Infrastructure page.
- **Retire:** Install new group, Configure new group, Open Group 2 to everyone (7 modes), Owner group opening, Repair Group 2 account access, Upgrade Group 2, Stop Group 2 placements, Prepare group capacity (folded into preflight). Their safety checks move into the new run.

## Technical details

- New orchestrator `frontend/scripts/add-group.ts` reuses the existing install, configure, settings, register, admission, opening, health and snapshot modules. Each module gets a group-id parameter in place of hard-coded `g2`. Results go to a stage journal on the `group-provision-receipts` branch with immutable-commit readback, bounded retries and refusal on unknown outcomes.
- Router: generalise `owner_opening.rs`/admission paths away from the `"g2"` literal. Add `record_approved_configuration` (governor-only, revision-checked) and `read_approved_configuration`. `generalActivation.ts` reads it live and keeps the committed snapshot only as a fallback during transition.
- Identity: the admission-reader grant becomes per-group (`authorize_group_admission(group_id)`), with the same two-read inventory pinning and no rehearsal flags.
- Preflight computes fuel from a live price quote plus a 20% margin. Card payment IDs are generated (`gN-setup-<date>-<n>`, no underscores).
- Approval values (`heapBudgetBytes`, `maxClubs`, `minCycles`) come from `groups::validate` limits, not from hand-written files.
- End-to-end replica test (`test-add-group-replica.mjs`) runs the whole orchestrator against local router, identity and 13 services, including interruption at every stage and resume. CI runs it.
- Group 1 and Group 2 are untouched. Group 2 records move to the new journal format by reading its live state, with no on-chain writes.
- Rules from project memory stay in force: photo-bearing clubs stay where they are, extra subnets stay disabled unless enabled, and fill-first thresholds (prepare at 70%, switch at 80%) still apply. A later option could let the capacity alert start "Add new group" automatically, but only with your approval.

## What still needs you

- One GitHub run per new group, plus approval of the admin step.
- One router and identity upgrade to install the generic version (done once, through the new Upgrade groups workflow).
- Funding if preflight reports fuel is short.
