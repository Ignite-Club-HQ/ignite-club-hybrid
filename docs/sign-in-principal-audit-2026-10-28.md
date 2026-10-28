# Internet Identity principal audit — 28 October 2026

## Conclusion

The application currently has two separate identity derivation domains. The same Internet Identity can therefore yield different principals on the Lovable site and the canister-hosted website/native bridge. This mechanism is proven by source and public deployed configuration; the exact historical mapping of Paul's two principals to origins is not established by the available account export.

This is not evidence that Paul chose different Internet Identity accounts. Previous statements attributing the difference to identity/profile selection were unsupported.

## Verified evidence

- `frontend/src/live/internetIdentityAuth.ts:79–110`: the known Lovable previews use `https://ignite-canister-connect.lovable.app`; canister aliases use their own `<canister>.icp0.io` origin. Unlisted sites use their own origin.
- `frontend/src/live/nativeInternetIdentity.ts:15–17,143–152`: Android defaults to a sign-in bridge on `https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io`. A build override can change that bridge; the installed Android build was not inspected.
- Git commit `5953324a`, 7 October 2026, introduced the published-Lovable derivation origin. The identity-domain split predates the late-October secure-name releases.
- Public read-only HTTP checks at approximately 06:40 UTC: the canister's `/.well-known/ii-derivation-origin` returns its own icp0.io origin. Its alternative-origins declaration does not list `ignite-canister-connect.lovable.app` or this project's preview. The Lovable site publishes a separate alternative-origins declaration including this project's preview. Merely listing an origin does not override a client's requested derivation origin.
- Paul's supplied Check account output from 06:16 UTC reports account `9ecadb71-c003-eb2f-7063-a4e0afcffdd4`, Active, version 3, with only the `mbrvi…` principal, a profile and app-admin role. Earlier reported exports had both `mbrvi…` and `tavrz…`; the approved move intervened. The current report does not establish how the earlier association was created.
- Ordinary frontend sign-in provisions with `registerAccount()`; it does not call `begin_link` or `accept_link`. Backend linking requires an account-owner challenge and acceptance by the exact target principal, with version/status checks. Governor rekey and narrowly constrained collision recovery are separate mutation paths.
- No inspected secure-name save path mints an Internet Identity principal. Principal derivation occurs at Internet Identity, before app account/profile provisioning. The previous account-ID collision and Group 2 membership-reader failure are separate defects, not proof of the origin of the two principals.
- Existing origin, redirect and native-bridge suites: 17 tests passed using Vitest's jsdom environment. These do not replace real same-identity Android/browser acceptance.

## Essential recurrence prevention

1. Establish which derivation origin currently produces the retained `mbrvi…` principal using Paul's normal authenticated session. An account export cannot reverse a principal into its Internet Identity account or originating website. Do not guess, create another account, or move memberships again.
2. Pin the existing intended production identity origin. Make production browser and native paths use it consistently, with matching Internet Identity alternative-origin declarations and bridge behavior. Do not blindly change the canonical origin: changing it can recreate the missing-account problem for existing sign-ins. Preserve intentionally separate test origins or redirect them to the approved production sign-in instead of silently provisioning an unexpected identity.
3. Add exact-value tests for every supported production browser origin and native bridge configuration, and a deployment check that rejects origin drift. Keep identity routing independent of backend/profile/PII release changes.
4. Verify one real Internet Identity on Android and the supported browser address produces the expected retained principal and reads the same existing account and memberships. Until this passes, recurrence prevention is not verified.

Multiple deliberately linked principals remain valid; the goal is to prevent unexpected identity-domain changes and lost access, not to reject safe user-approved linking. No configuration, live account, membership or deployment was changed during this audit.

## Reference

Internet Identity derives per-origin pseudonyms; stable shared derivation origins must be configured before changing existing users' identity routing: https://docs.internetcomputer.org/guides/authentication/shared-sessions.md