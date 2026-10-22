# Restore Ignite’s speed and reliability with multiple groups

## Outcome
Restore the experience you had with one group: taps respond immediately, returning to a page shows its saved content immediately, and every club’s teams, chats, events and photos appear from the correct group. Fix the shared causes together, rather than continuing with isolated page patches.

This is a recovery plan, not a claim that the latest repairs work on your account. Existing test passes and signed-out checks have not established that. The first release gate is real signed-in evidence.

## What the review found
Source inspection confirms four architectural problems still need a coordinated solution:

1. **Parallel does not mean progressive.** Several helpers retain successful replies but wait for *all* requests to finish before returning. `settleAll`, `readAcross` and session discovery can therefore still make a healthy club wait for a slow group. Some aggregators discard the failure details afterwards, making incomplete data look complete.
2. **Opening an item can rediscover the world.** Unknown team/chat/event ownership can trigger every-group discovery plus a fresh directory confirmation. Remembering original-group items can reopen a session, and the ownership-recording loop awaits each club individually. Group 1 routes and genuinely unresolved routes must not be treated as the same thing.
3. **The navigation thread still does expensive work.** The ICP cache is debounced, but each save still inspects/dehydrates the entire eligible cache on the main thread. It has no explicit byte/query budget or teardown, and scheduling work during idle time does not split the work into small pieces. Page imports, actor setup, feed merging and image processing also need measured CPU attribution.
4. **Scope and lifecycle rules are fragmented.** Club selection, page filters, URL context, entity ownership, memberships, query keys and refresh rules are coordinated in multiple places. Stale or incomplete answers can hide data, select the wrong group, or delay unrelated sections.

Recent fixes address parts of these problems, but need integration verification. Duplicate Giddy Goat conversations, exact live request timing and current canister latency remain unconfirmed. Historical comments/instructions also describe obsolete closed/rehearsal paths; reconcile them against actual live approval, rather than changing gates based on comments.

## 1. Establish the baseline and expected data
Before further repairs, capture one representative signed-in session and identify its app version, group inventory and device. Use the existing reported examples rather than asking you to repeat every symptom:

- Group 1: Giddy Goat, Winter Cats/Peanut and Riverdogs, where applicable to the account.
- Group 2: Group 2 test, its U9 team and default club chats.
- Read-only discovery of any other currently registered group: verify which is actually open before including it in results.

Build a privacy-safe expected-data checklist from authorized reads: club/team IDs, conversation IDs and audiences, event IDs/dates, photo references and comment receipts. Compare what exists with what each screen shows. Do not log message bodies, child names, credentials or decrypted media.

Capture cold start, warm return, club switching, opening a thread, and phone background/resume. Separate time spent on identity restoration, routing approval, membership discovery, content reads, key unlocks, rendering and main-thread blocking. Record requests by method/group, repeated calls, retries, p50/p95 timing and time to first useful content—not just when every background task finishes.

**Deliverable:** one joined failure/request map, expected-data inventory and baseline timing table. Identify client defects versus genuinely slow/rejected canister methods before choosing a server upgrade.

## 2. Repair the shared routing and discovery layer
Implement and verify this before tuning individual pages:

- One identity-and-target-scoped discovery coordinator shared by every page. Coalesce approval, registry, membership, role-grant and assignment requests; avoid separate discovery chains for each widget.
- Distinguish **verified legacy/shared**, **assigned group**, **unresolved** and **failed** ownership. An absent assignment or failed request must not by itself prove that an entity belongs to Group 1.
- Carry verified club context from lists into team, event, media and thread reads. Opening a known item must not scan unrelated groups. Keep exact authoritative discovery for deep links or genuinely unknown resources.
- Record ownership once per unique club in batches, not with a serial reopen/check for each list item. Avoid rebuilding the group session merely because a verified Group 1 item has no new-group assignment.
- Audit all entity kinds for stale positive/negative ownership, not just U9 teams. Scope hints to account, host, network, target IDs and appropriate revisions; invalidate after creation, joining, removal, target change or verified directory drift.
- Mark shared personal data explicitly: identity/profile data, DMs, typing, presence and app settings must not fan out to every club group.
- Retain complete revision-bound discovery for authorization, writes and unique ownership claims. Ordinary display hints cannot grant membership, authorize a write or silently redirect an assigned club to another group.

**Acceptance:** known Group 1 and Group 2 items make content calls only to their intended group; concurrent requests share discovery; join/create changes are visible without sign-out; conflicts and unknown outcomes fail safely.

## 3. Make navigation independent of data loading
- Bottom navigation, profile menus, back navigation and club selection update immediately even while groups or photos are loading. A destination page can render independently of its content requests.
- Inspect global loading gates, suspended page imports, overlays and synchronous click handlers. Prefetch likely page code with bounded idle work, not a competing boot-time import burst.
- Profile actor/IDL construction to confirm the recent reuse repair covers each target, domain and identity without rebuilding per request.
- Replace whole-cache work with bounded, scheduled persistence of changed eligible queries. Use one managed subscription per client/session, cancel timers/listeners on teardown, and retain limits for size, age and query count.
- Break measured heavy merges/decoding into small jobs; move suitable pure computation off the UI thread only where profiling justifies it. Prioritize visible text and active-thread work over image prefetch and off-screen sections.
- Limit background concurrency and polling; cancel supported reads or ignore obsolete replies after navigation, filter changes, sign-out or session replacement. Never cancel-and-replay an uncertain mutation.

**Acceptance:** taps remain responsive during cold loads, cache saves, image unlocks and group failures; no application-caused long task over 100 ms on the tested phone.

## 4. Show useful data immediately without lying about completeness
- Use per-club/per-section query state so healthy authorized results appear without waiting for the slowest club. Avoid page-wide `all`/`allSettled` barriers for presentation.
- Preserve last-good authorized results during temporary failures, with a scoped refresh/error state. An incomplete refresh must not erase another club’s rows or become a persisted authoritative empty list.
- Distinguish successful empty, loading, transport failure, access denial and authoritative deletion. Denied/revoked scopes are evicted; temporary failures retain permitted cached content. Do not soften security-critical full-inventory checks into partial success.
- Make cached results account/target/backend/filter-specific. Guard asynchronous hydration and replies against account switches; clear pending work and protected caches on sign-out/removal as required.
- Audit which actual page query shapes persist successfully. Do not assume enabling a persistence helper makes every page instant. Keep tokens, keys, ciphertext links and expired object URLs out of page snapshots; preserve the separate authorized media-cache policy.
- Standardize mutation invalidation and acknowledged updates: a successful save appears once immediately and is reconciled by its returned ID, then verified by fresh readback.

## 5. Repair every affected journey as one integration batch

| Area | Required repair and verification |
|---|---|
| Clubs/theme picker | All authorized clubs from all groups; no sport filtering. Only the club theme picker filters My Clubs. Newly joined/created clubs appear without restarting. |
| Home/team carousel | Both groups’ teams; correct active-club filter; independent reveal of sections; no missing-photo error blocking the feed. Known teams open without ownership scans. |
| Next Up/Schedule | Reuse scoped event candidates and known team names; fetch clubs concurrently; show events as sections resolve. Calendar dots, selected-day list and Next Up agree, including Adelaide date boundaries and recurring/cancelled games. For me reuses calendar data; Whole club reads its exact clubs. |
| Teams | U9 in Group 2 test opens from carousel, club page and deep link. A read failure is not “team not found”. Roles, roster and dependent sections use the same correct scope. |
| Messages inbox | Correct clubs and audiences; missing Group 2 threads recovered; no false empty inbox while sources are unresolved. Reconcile the existing stable inbox model with progressive sources without losing unread/history state. |
| Default/duplicate chats | Inspect Giddy Goat IDs, group ownership, audiences and creation records. Deduplicate repeated *same-ID listings* only. For distinct same-name conversations, preserve history and propose any necessary reconciliation separately. Default-chat creation must be authoritative and idempotent across devices/retries; a frontend promise alone is insufficient. Remove unconditional setup work from ordinary inbox loading. |
| Thread opening | Peanut and Group 2 threads open from inbox, notification and deep link. Load metadata/history together where permitted; do not make messages wait for authors, presence, reactions, polls or image unlocks. No inaccurate unstable-connection diagnosis for routing/access rejection. |
| Polls/chat attachments | Exact conversation/club scope for reads and actions; polls reach success or a bounded retryable error, never endless loading. Images use their original authorized store/key path; cached repeats skip duplicate downloads/unlocks; first unlock timing is measured separately. Preserve the 30-day key policy. |
| Gallery/comments | Both groups’ photos, correct filter/deep-link behavior, authorized decryption and independent placeholders. Post a comment, see its acknowledged ID once, navigate away/back, then verify fresh readback. Failed posts retain the draft. |
| Remaining pages/actions | Audit Vault, notifications, rewards, league/competition pages, invites, profile menu and detail screens for unscoped group reads, slow parent gates and stale invalidation. Exercise representative create/edit/RSVP/send/upload actions with exact scopes and no unsafe retry. |

## 6. Address proven canister bottlenecks—not speculative infrastructure
If traces show required protected account reads dominate cold loading, review those exact contracts with live canister versions. Keep their admission checks; investigate smaller bounded responses, authoritative aggregate reads, indexes and eliminating repeated cross-canister authorization work. Verify compatibility for legacy and new groups before proposing a narrowly scoped upgrade.

Do not solve this by disabling security checks, returning everything to Group 1, moving encrypted-media clubs, adding groups/subnets or a paid gateway. No new realtime gateway is required for this recovery; optimize current visible/background polling and reconnect behavior. App fixes and any separately necessary canister upgrade get explicit release evidence and rollback instructions.

## 7. Measurable release gates
Targets are acceptance criteria, not a promise that an uncached ICP consensus/key operation completes instantly. Measure on the reported 411 × 770 phone-sized view, a representative Android WebView and desktop, with a repeatable healthy-network profile.

| Measurement | Target |
|---|---|
| Tap feedback/navigation selection | p95 ≤100 ms; destination frame ≤200 ms |
| Warm return to a loaded page/thread | useful cached content p95 ≤300 ms |
| Cold signed-in page open | first useful live content p95 ≤3 s; core lists complete ≤5 s on the healthy test profile |
| Known thread, no saved history | text/history p95 ≤3 s; media not on the text critical path |
| First uncached media unlock | report separately; bounded success/error, no endless placeholder |
| Routing requests | zero ownership scans for known scoped items; no duplicate concurrent identical discovery; registry checks follow the documented safety contract |
| Failure isolation | a delayed/refused group cannot block navigation or erase a healthy club’s authorized content |

For short runs report raw measurements, not unreliable percentile claims. Run enough repeated controlled samples to substantiate p95 and record any target miss with its cause. Compare one-group and mixed-group accounts at similar data volume. Simulate additional groups in tests to ensure navigation/known-scope reads do not grow with total group count.

## 8. Verification and release sequence
1. Add behavior-level routing, ownership lifecycle, cache isolation, failure-isolation, duplicate-ID and default-chat concurrency tests. Existing source-shape/guard tests remain useful, but cannot prove a working chat or photo.
2. Run focused suites for both backend modes, then the full existing frontend suite with the project’s supported test setup. Rehearse delayed groups, denied reads, registry drift, account switches and native resume.
3. Signed-in acceptance: both-group data inventory, Peanut poll/images, Group 2 chats/U9, Giddy Goat duplicate diagnosis, gallery comment send/readback and rapid bottom-nav taps while reads remain outstanding. Also verify club removal blocks new reads/writes without disturbing other clubs or DMs.
4. Produce one results table: expected/observed data, before/after timing, request counts, failures and remaining blockers. Unit-test counts alone are not completion.
5. Release the integrated app repair after these gates, with explicit approval to publish and, if necessary, a separate exact canister-upgrade approval. Recheck the actual published/native version; a web release does not update an installed native bundle.

**Current verification blocker:** the sandbox has no usable signed-in Internet Identity session; external Supabase session tools cannot supply one. We can implement and run automated tests without your credentials, but final private-account acceptance requires your signed-in preview/device session or an approved controlled Internet Identity test account. Do not ask you to share private credentials.

## Scope and completion
Keep prices, allowances, payments, deployment identities, original media keys, live routing approval and one-click group setup unchanged. No data deletion, group migration, broad reinstall or unrelated deployment. Work in substantial connected batches: baseline/shared routing → navigation/cache → complete feature recovery → signed-in acceptance/release. No unsolicited hourly updates.

Done means the reported data is present, actions read back successfully, timing gates are evidenced, and the same failure patterns cannot recur simply by adding another group—not merely that code compiles.