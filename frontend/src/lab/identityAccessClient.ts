import type { _SERVICE, State } from './bindings/identity_access/declarations/identity_access.did.js';

export type IdentityAccessClient = ReturnType<typeof createIdentityAccessClient>;

export function createIdentityAccessClient(actor: _SERVICE) {
  let disposed = false;
  const live = () => { if (disposed) throw new Error('Identity changed; operation discarded'); };
  const call = async <T>(operation: () => Promise<{ Ok: T } | { Err: string }>) => {
    live();
    const result = await operation();
    live();
    if ('Err' in result) throw new Error(result.Err);
    return result.Ok;
  };
  return {
    whoami: () => call(() => actor.whoami()),
    getProfile: () => call(() => actor.get_profile()),
    readSecureNameAuthority: () => call(() => actor.read_secure_name_authority()),
    setProfile: (displayName: string, avatarRef?: string) =>
      call(() => actor.set_profile(displayName, avatarRef ? [avatarRef] : [])),
    myRoles: () => call(() => actor.my_roles()),
    searchProfiles: (query: string, limit: number) => call(() => actor.search_profiles(query, limit)),
    searchGuardianProfiles: (authority: Parameters<_SERVICE['search_guardian_profiles']>[0], childId: string, query: string, limit: number) =>
      call(() => actor.search_guardian_profiles(authority, childId, query, limit)),
    readGuardianProfileCandidates: (authority: Parameters<_SERVICE['read_guardian_profile_candidates']>[0], childId: string, cursor: Parameters<_SERVICE['read_guardian_profile_candidates']>[2]) =>
      call(() => actor.read_guardian_profile_candidates(authority, childId, cursor)),
    readGuardianProfiles: (authority: Parameters<_SERVICE['read_guardian_profiles']>[0], childId: string, subjects: Parameters<_SERVICE['read_guardian_profiles']>[2], revision: bigint) =>
      call(() => actor.read_guardian_profiles(authority, childId, subjects, revision)),
    readClubProfiles: (authority: Parameters<_SERVICE['read_club_profiles']>[0], clubId: string, subjects: Parameters<_SERVICE['read_club_profiles']>[2]) =>
      call(() => actor.read_club_profiles(authority, clubId, subjects)),
    getProfilesByIds: (ids: string[]) => actor.get_profiles_by_ids(ids),
    myTermsAcceptance: () => call(() => actor.my_terms_acceptance()),
    getTermsAcceptance: (accountId: string) => call(() => actor.get_terms_acceptance(accountId)),
    setTermsAcceptance: (termsVersion: number) => call(() => actor.set_terms_acceptance(termsVersion)),
    setThemePreference: (theme: string | null) => call(() => actor.set_theme_preference(theme ? [theme] : [])),
    setClubSwitcherHintSeen: () => call(() => actor.set_club_switcher_hint_seen()),
    exportState: () => call<State>(() => actor.export_state()),
    eraseAccount: (accountId: string) => call(() => actor.erase_account(accountId)),
    prepareAccountDeletion: (accountId: string, revision: bigint) => call(() => actor.prepare_account_deletion(accountId, revision)),
    commitAccountDeletion: (accountId: string) => call(() => actor.commit_account_deletion(accountId)),
    settleAccountDeletion: (accountId: string) => call(() => actor.settle_account_deletion(accountId)),
    cancelAccountDeletion: (accountId: string) => call(() => actor.cancel_account_deletion(accountId)),
    registerAccount: () => call(() => actor.register_account()),
    access: (club?: string, team?: string, child?: string) => call(() => actor.access(club ? [club] : [], team ? [team] : [], child ? [child] : [])),
    accessScoped: (siteId?: string, club?: string, team?: string, child?: string) => call(() => actor.access_scoped(siteId ? [siteId] : [], club ? [club] : [], team ? [team] : [], child ? [child] : [])),
    checkFieldAccess: (accountId: string, section: string) => call(() => actor.check_field_access(accountId, section)),
    beginLink: (target: Parameters<_SERVICE['begin_link']>[0]) => call(() => actor.begin_link(target)),
    acceptLink: (id: bigint) => call(() => actor.accept_link(id)),
    revoke: (principal: Parameters<_SERVICE['revoke']>[0], expectedVersion: bigint) => call(() => actor.revoke(principal, expectedVersion)),
    grantRole: (accountId: string, role: string, club?: string, team?: string, siteId?: string) =>
      call(() => actor.grant_role_scoped(accountId, role, siteId ? [siteId] : [], club ? [club] : [], team ? [team] : [])),
    revokeRole: (accountId: string, role: string, club?: string, team?: string, siteId?: string) =>
      call(() => actor.revoke_role_scoped(accountId, role, siteId ? [siteId] : [], club ? [club] : [], team ? [team] : [])),
    setAccountStatus: (accountId: string, status: "Active" | "Suspended") =>
      call(() => actor.set_account_status(accountId, status === "Active" ? { Active: null } : { Suspended: null })),
    setFamily: (accountId: string, childId: string) => call(() => actor.set_family(accountId, childId)),
    setExclusion: (accountId: string, club: string, team?: string, siteId?: string) =>
      call(() => actor.set_exclusion_scoped(accountId, siteId ? [siteId] : [], club, team ? [team] : [])),
    getPrivacyConsent: (accountId: string, purpose: string) => call(() => actor.get_privacy_consent(accountId, purpose)),
    setPrivacyConsent: (accountId: string, purpose: string, granted: boolean) =>
      call(() => actor.set_privacy_consent(accountId, purpose, granted)),
    getMyEntitlements: () => call(() => actor.get_my_entitlements()),
    isPro: (principal: Parameters<_SERVICE['is_pro']>[0]) => call(() => actor.is_pro(principal)),
    redeemEntitlement: (
      productId: string,
      transactionId: string,
      expiresAtMs: bigint,
      source: string,
      signatureHex: string,
    ) => call(() => actor.redeem_entitlement(productId, transactionId, expiresAtMs, source, signatureHex)),
    dispose() { disposed = true; },
  };
}
