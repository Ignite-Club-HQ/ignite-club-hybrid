// Account claim invitations for the club migration tool.
//
// For each Supabase member of the club (club/team roles, and parents/guardians of
// children on its teams) the tool creates a random one-time token, registers only
// its SHA-256 hash on the destination group's club_domain, and — after the
// canister acknowledged the page — emails the link to the member's Supabase
// address. Already-claimed members are skipped. A lost registration reply sends
// no email for that page; rerunning simply issues fresh links.
import { createHash, randomBytes } from 'node:crypto';
import { assertMigrationApproval } from './migrate-club-plan.mjs';

export const CONFIRM_INVITE = 'SEND CLAIM EMAILS';
export const CLAIM_TTL_MS = 14 * 24 * 3600 * 1000;
const PAGE = 500;

export const newToken = () => randomBytes(32).toString('hex');
export const hashToken = (t) => createHash('sha256').update(t, 'utf8').digest('hex');

export function maskEmail(email) {
  const [user, domain] = String(email ?? '').split('@');
  if (!user || !domain) return '';
  return `${user[0]}***@${domain}`.slice(0, 128);
}

export function claimLink(appUrl, group, token) {
  return `${String(appUrl).replace(/\/+$/, '')}/claim-account?g=${encodeURIComponent(group)}#t=${token}`;
}

/** Distinct Supabase user ids belonging to the club. */
export function collectMembers({ roles = [], childAssignments = [], children = [], guardians = [] }) {
  const ids = new Set(roles.map((r) => r.user_id).filter(Boolean));
  const kids = new Set(childAssignments.map((a) => a.child_id));
  for (const c of children) if (kids.has(c.id) && c.parent_id) ids.add(c.parent_id);
  for (const g of guardians) if (kids.has(g.child_id) && g.guardian_id) ids.add(g.guardian_id);
  return [...ids].sort();
}

export function claimEmail({ clubName, link }) {
  const club = clubName || 'Your club';
  return {
    subject: `${club} is moving — link your account`,
    text: `${club} is moving to Internet Identity sign-in.\n\nTap this link once to keep your children, RSVPs and points:\n${link}\n\nThe link works once, only for you, and expires in 14 days. If you didn't expect this, ignore it.`,
  };
}

/**
 * ctx = { clubId, group, db: { all(table, query) }, authEmail(userId), registerPage(rows), claimedUsers(), sendEmail({to, subject, text}), appUrl, now, log }
 */
export async function sendClaimInvites(ctx) {
  assertMigrationApproval(ctx.approval, 'auth', ctx.clubId, ctx.group);
  const inList = (ids) => `in.(${ids.map((i) => `"${i}"`).join(',')})`;
  const [roles, teams, [club]] = await Promise.all([
    ctx.db.all('user_roles', `club_id=eq.${ctx.clubId}`),
    ctx.db.all('teams', `club_id=eq.${ctx.clubId}`),
    ctx.db.all('clubs', `id=eq.${ctx.clubId}`),
  ]);
  const teamIds = teams.map((t) => t.id);
  const teamRoles = [], childAssignments = [];
  for (let i = 0; i < teamIds.length; i += 100) {
    const ids = inList(teamIds.slice(i, i + 100));
    teamRoles.push(...await ctx.db.all('user_roles', `team_id=${ids}`));
    childAssignments.push(...await ctx.db.all('child_team_assignments', `team_id=${ids}`));
  }
  const childIds = [...new Set(childAssignments.map((a) => a.child_id))];
  const children = [], guardians = [];
  for (let i = 0; i < childIds.length; i += 100) {
    const ids = inList(childIds.slice(i, i + 100));
    children.push(...await ctx.db.all('children', `id=${ids}`));
    guardians.push(...await ctx.db.all('child_guardians', `child_id=${ids}`));
  }
  const claimed = new Set(await ctx.claimedUsers());
  const members = collectMembers({ roles: [...roles, ...teamRoles], childAssignments, children, guardians }).filter((u) => !claimed.has(u));
  const result = { members: members.length + claimed.size, alreadyLinked: claimed.size, sent: 0, noEmail: 0, failed: 0 };
  for (let i = 0; i < members.length; i += PAGE) {
    const page = [];
    for (const user of members.slice(i, i + PAGE)) {
      const email = await ctx.authEmail(user);
      if (!email) { result.noEmail++; continue; }
      const token = newToken();
      page.push({ user, email, token, row: { token_hash: hashToken(token), source_user: user, email_hint: maskEmail(email), expires_ms: BigInt(ctx.now + CLAIM_TTL_MS) } });
    }
    if (!page.length) continue;
    await ctx.registerPage(page.map((p) => p.row)); // throws on refusal or lost reply: no emails for this page
    for (const p of page) {
      try { await ctx.sendEmail({ to: p.email, ...claimEmail({ clubName: club?.name, link: claimLink(ctx.appUrl, ctx.group, p.token) }) }); result.sent++; }
      catch { result.failed++; }
    }
  }
  return result;
}
