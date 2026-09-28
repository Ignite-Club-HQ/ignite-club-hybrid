import { expect, test } from 'vitest';
import {
  canAccessVault,
  getVaultAdminUpgradeInfo,
  getVaultTeamIds,
  hasVaultProEntitlement,
  hasVaultRoleAccess,
  isVaultClubAdminOrCommittee,
  isVaultCoachOrTeamAdmin,
  resolveVaultContextPro,
} from '../src/lab/vaultAccess';
import type { VaultFolderView, VaultRoleRecord } from '../src/lab/vaultAccessTypes';

const clubView: VaultFolderView = {
  type: 'club',
  clubId: 'club-1',
  clubName: 'Club One',
};
const teamView: VaultFolderView = {
  type: 'team',
  clubId: 'club-1',
  clubName: 'Club One',
  teamId: 'team-1',
  teamName: 'Team One',
};

test('recognizes only supported vault roles and app-admin override', () => {
  const roles: VaultRoleRecord[] = [{ role: 'coach' }, { role: 'member' }];
  expect(hasVaultRoleAccess(false, roles)).toBe(true);
  expect(hasVaultRoleAccess(false, [{ role: 'member' }])).toBe(false);
  expect(hasVaultRoleAccess(true, undefined)).toBe(true);
});

test('scopes club and team management checks to the active club', () => {
  expect(isVaultClubAdminOrCommittee(false, clubView, [
    { role: 'club_admin', club_id: 'club-2' },
  ])).toBe(false);
  expect(isVaultClubAdminOrCommittee(false, clubView, [
    { role: 'committee_member', club_id: 'club-1' },
  ])).toBe(true);
  expect(isVaultCoachOrTeamAdmin(false, teamView, [
    { role: 'team_admin', club_id: 'club-1' },
  ])).toBe(true);
  expect(isVaultCoachOrTeamAdmin(false, teamView, [
    { role: 'coach', club_id: 'club-2' },
  ])).toBe(false);
});

test('does not grant club-scoped management access from the root view', () => {
  expect(isVaultClubAdminOrCommittee(false, { type: 'root' }, [
    { role: 'club_admin', club_id: 'club-1' },
  ])).toBe(false);
  expect(isVaultCoachOrTeamAdmin(false, { type: 'root' }, [
    { role: 'coach', club_id: 'club-1' },
  ])).toBe(false);
});

test('selects the first valid admin upgrade scope and collects team ids', () => {
  const roles: VaultRoleRecord[] = [
    { role: 'team_admin', team_id: 'team-1' },
    { role: 'club_admin', club_id: 'club-1' },
    { role: 'coach', team_id: 'team-2' },
  ];
  expect(getVaultAdminUpgradeInfo(roles)).toEqual({ clubId: 'club-1', teamId: undefined });
  expect(getVaultTeamIds(roles)).toEqual(['team-1', 'team-2']);
  expect(getVaultAdminUpgradeInfo([{ role: 'team_admin', team_id: 'team-3' }])).toEqual({
    clubId: undefined,
    teamId: 'team-3',
  });
});

test('recognizes subscription overrides and resolves context-specific pro access', () => {
  expect(hasVaultProEntitlement({ admin_pro_override: true })).toBe(true);
  expect(hasVaultProEntitlement({ is_pro_football: true })).toBe(true);
  expect(hasVaultProEntitlement(undefined)).toBe(false);
  expect(resolveVaultContextPro(teamView, false, true)).toBe(true);
  expect(resolveVaultContextPro(teamView, false, false)).toBe(false);
  expect(resolveVaultContextPro(clubView, true, false)).toBe(true);
  expect(resolveVaultContextPro({ type: 'root' }, true, true)).toBe(false);
});

test('requires both role access and the relevant pro scope', () => {
  expect(canAccessVault({
    isAppAdmin: false,
    hasRoleAccess: true,
    hasAnyPro: true,
    currentContextHasPro: false,
    isRoot: true,
  })).toBe(true);
  expect(canAccessVault({
    isAppAdmin: true,
    hasRoleAccess: false,
    hasAnyPro: false,
    currentContextHasPro: false,
    isRoot: false,
  })).toBe(false);
  expect(canAccessVault({
    isAppAdmin: true,
    hasRoleAccess: true,
    hasAnyPro: false,
    currentContextHasPro: false,
    isRoot: false,
  })).toBe(true);
  expect(canAccessVault({
    isAppAdmin: false,
    hasRoleAccess: true,
    hasAnyPro: true,
    currentContextHasPro: false,
    isRoot: false,
  })).toBe(false);
});
