# Team invitation ICP release status

## Implemented locally

ICP invitation creation, manual sharing, previews and acceptance no longer call Supabase. Supabase mode retains its separate existing flow. Resend activation remains deferred; created links are not reported as delivered emails.

Both club and mini-league canisters enforce current issuer authority, exact scope, revocation, random credentials and caller-bound retry receipts. Historical ordinary invitation email fields are scrubbed by a new migration; public previews redact recipient details.

Parent links show child entry when no children were supplied. Named mini-league child invites do not compare the child's name with the adult's profile. Family invites retain up to 12 existing/new children, encrypted names/birth-year/jersey details and a distinct optional guardian invitation, including a selected existing-account guardian. All children and both invite records commit together. Existing family relationships remain intact; the second guardian accepts only after the first parent, and retries cannot recreate removed guardian access.

## Verification

Focused frontend suites pass in ICP and Supabase modes. Real disposable two-group club/mini-league checks pass for credentials, permissions, redaction, retry, revoke and upgrade retention. Deployment-policy tests, ICP guards and 17-contract Candid drift pass. Public browser routes show sign-in or invalid-invite state without runtime errors; this is not signed-in live acceptance.

## Deployment blocked pending source synchronization

The protected invite workflow is now present on hybrid main (HTTP 200 at 01:40 UTC), but the latest family migration `20261118_000000.mo` is still missing (HTTP 404). Do not deploy the earlier partial release or run broader workflows instead. Nothing has been upgraded or activated in this task; the prod repository remains untouched. Wait until the final family contract and matching frontend source are present, then compare source fingerprints before dispatch.

Once the tested files are present on hybrid:

1. Run **Upgrade team invites (both ICP groups)** with action `check`.
2. Review the four-target report and protected approvals.
3. Run the same tested release with action `upgrade`, confirmation **UPGRADE BOTH GROUPS TEAM INVITES**.
4. Confirm all four club/mini-league outcomes and the verified snapshot commit. Unknown outcomes retain the journal; do not blindly replay.
5. Run **Deploy web app (ICP frontend canister)** after that snapshot commit.
6. Test signed-in creation, copy/share, Group 1/2 acceptance, parent child entry, guardian/admin invitations and revocation on the real app.

The shared router and unrelated services must not be upgraded by this invitation release.