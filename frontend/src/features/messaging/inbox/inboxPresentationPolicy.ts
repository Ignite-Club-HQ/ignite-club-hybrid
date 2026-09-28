interface IdentifiedClub {
  id: string;
}

export function resolveInboxGroupCreationCapability(options: {
  adminTeamCount: number;
  adminClubCount: number;
  isAppAdmin: boolean;
  isCommitteeMember: boolean;
  hasAnyProAccess?: boolean;
}): { hasAdminRole: boolean; canCreateGroups: boolean } {
  const hasAdminRole = options.adminTeamCount > 0 || options.adminClubCount > 0 ||
    options.isAppAdmin || options.isCommitteeMember;
  return {
    hasAdminRole,
    canCreateGroups: hasAdminRole && (options.hasAnyProAccess === true || options.isAppAdmin),
  };
}

export function resolveInboxEmptyState(options: {
  query: string;
  unifiedConversationCount: number;
  teamCount: number;
  memberClubCount: number;
  visibleGroupCount: number;
  directMessageCount: number;
}): { hasNoResults: boolean; hasNoMessages: boolean } {
  return {
    hasNoResults: !!options.query && options.unifiedConversationCount === 0,
    hasNoMessages: options.teamCount === 0 && options.memberClubCount === 0 &&
      options.visibleGroupCount === 0 && options.directMessageCount === 0,
  };
}

export function resolveInboxUpgradePresentation(options: {
  effectiveClubId?: string | null;
  clubProStatuses?: Record<string, boolean>;
  hasAnyProAccess?: boolean;
  isProAccessLoading: boolean;
  isProAccessFetching: boolean;
  isClubProLoading: boolean;
  isClubProFetching: boolean;
  adminTeamCount: number;
  adminClubs: readonly IdentifiedClub[];
  memberClubs: readonly IdentifiedClub[];
  isAppAdmin: boolean;
}): {
  scopedClubIsPro: boolean | null;
  hasAdminRoleButNoPro: boolean;
  upgradeClubId: string | null;
} {
  const proAccessReady = !options.isProAccessLoading && !options.isProAccessFetching &&
    options.hasAnyProAccess !== undefined;
  const clubProReady = !options.isClubProLoading && !options.isClubProFetching &&
    options.clubProStatuses !== undefined;
  const scopedClubIsPro = options.effectiveClubId
    ? options.clubProStatuses?.[options.effectiveClubId] === true
    : null;
  const proGateFails = options.effectiveClubId
    ? clubProReady && scopedClubIsPro === false
    : proAccessReady && options.hasAnyProAccess === false;
  const hasAdminRole = options.adminTeamCount > 0 || options.adminClubs.length > 0;
  const hasAdminRoleButNoPro = proAccessReady && clubProReady && hasAdminRole &&
    proGateFails && !options.isAppAdmin;
  const scopedAdminClubId = options.effectiveClubId
    ? options.adminClubs.find((club) => club.id === options.effectiveClubId)?.id ?? null
    : null;
  const upgradeClubId = options.effectiveClubId
    ? scopedAdminClubId ?? options.effectiveClubId
    : options.adminClubs[0]?.id ?? options.memberClubs[0]?.id ?? null;

  return { scopedClubIsPro, hasAdminRoleButNoPro, upgradeClubId };
}
