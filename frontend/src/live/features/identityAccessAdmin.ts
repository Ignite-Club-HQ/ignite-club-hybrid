import { getActiveIcpTarget } from "../targetRegistry";
import { getCurrentInternetIdentityConfirmed } from "../internetIdentityAuth";
import { connectLiveIdentityAccessClientWithIdentity } from "../identityAccess";

/**
 * Admin (governor or app_admin) identity_access mutations used by the ICP
 * Manage Users page: account suspend/reactivate and role grant/revoke.
 * Loaded via dynamic import from ManageUsersPage so the Supabase branch
 * never pulls in the ICP agent stack.
 */
async function adminClient() {
  const target = getActiveIcpTarget();
  const identity = await getCurrentInternetIdentityConfirmed(3, 1000);
  if (!identity) throw new Error("Sign in with Internet Identity to manage users.");
  return connectLiveIdentityAccessClientWithIdentity(target, identity);
}

export async function setLiveAccountStatus(accountId: string, status: "Active" | "Suspended") {
  const { client } = await adminClient();
  try {
    return await client.setAccountStatus(accountId, status);
  } finally {
    client.dispose();
  }
}

export async function grantLiveRole(
  accountId: string,
  role: string,
  club?: string,
  team?: string,
  siteId?: string,
) {
  const { client } = await adminClient();
  try {
    return await client.grantRole(accountId, role, club, team, siteId);
  } finally {
    client.dispose();
  }
}

export async function revokeLiveRole(
  accountId: string,
  role: string,
  club?: string,
  team?: string,
  siteId?: string,
) {
  const { client } = await adminClient();
  try {
    return await client.revokeRole(accountId, role, club, team, siteId);
  } finally {
    client.dispose();
  }
}
