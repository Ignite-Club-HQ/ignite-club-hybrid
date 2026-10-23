/** Lazy caller-private actor connection. Diagnostic responses never become
 * discovery answers; this transport remains hard-off pending release proof. */
import type { FeatureBackendContext } from './featureRouter';
import type { DirectoryContinuation } from './membershipDirectoryDiscovery';
import type { Reply } from '../lab/bindings/identity_access/declarations/identity_access.did';

export const MEMBERSHIP_LOOKUP_RELEASE_ENABLED = false;

export function requireVerifiedDirectoryReply(reply: Reply, caller: string): Reply {
  if (reply.caller.toText() !== caller || reply.account_version < 1n || reply.generation < 1n || reply.registry_revision < 1n ||
      reply.inventory_digest.length !== 32 || reply.rows.length > 100) throw new Error('Membership directory identity or inventory changed');
  if (!reply.verified_current) throw new Error('Membership directory requires Stage A discovery');
  return reply;
}

/** Real diagnostic endpoint for explicitly requested private acceptance; not
 * invoked by ordinary navigation while the release switch is off. */
export async function readLiveMembershipDirectoryDiagnostic(
  ctx: FeatureBackendContext, consumer: bigint, continuation: DirectoryContinuation | null,
): Promise<Reply> {
  const principal = ctx.identity.getPrincipal().toText();
  if (!principal || principal === '2vxsx-fae') throw new Error('Authenticated lookup caller required');
  const [{ createLiveActor }, { idlFactory }] = await Promise.all([
    import('./icpAgent'), import('../lab/bindings/identity_access/declarations/identity_access.did.js'),
  ]);
  const { actor } = await createLiveActor<import('../lab/bindings/identity_access/declarations/identity_access.did')._SERVICE>(
    ctx.target, ctx.identity, 'identity_access', 'Identity access', idlFactory,
  );
  const response = await actor.read_my_membership_directory_diagnostic(consumer, continuation ? [continuation] : []);
  if (ctx.identity.getPrincipal().toText() !== principal) throw new Error('Membership directory identity changed');
  if ('Err' in response) throw new Error(response.Err);
  if (response.Ok.caller.toText() !== principal) throw new Error('Foreign membership directory caller');
  return response.Ok;
}

export async function readReleasedMembershipDirectory(): Promise<never> {
  // No fabricated currentness or locally echoed registry fingerprint. A real
  // released current-reader contract must replace this refusal before enable.
  throw new Error('Membership directory requires Stage A discovery');
}