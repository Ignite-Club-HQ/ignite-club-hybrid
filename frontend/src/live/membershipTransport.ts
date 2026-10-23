/** Explicit opt-in adapter for the permanent membership lookup.
 * No default reader, actor connection, endpoint, timer or registration lives
 * here: the lookup stays disabled until a verified release installs a reader.
 * Any failure or uncertainty propagates so groupSession keeps complete
 * Stage A discovery. */
import type { GroupSessionTransport } from './groupSession';

type Reader = NonNullable<GroupSessionTransport['readMembershipDirectory']>;

export function membershipTransport(
  transport: GroupSessionTransport,
  options: { enabled: boolean; read: Reader },
): GroupSessionTransport {
  // Explicitly remove any inherited optional reader when disabled.
  const { readMembershipDirectory: _reader, ...stageA } = transport;
  if (!options.enabled) return stageA;
  return {
    ...stageA,
    async readMembershipDirectory(ctx, continuation, fingerprint) {
      const page = await options.read(ctx, continuation, fingerprint);
      if (page.verifiedCurrent !== true) {
        throw new Error('Membership directory requires Stage A discovery');
      }
      return page;
    },
  };
}
