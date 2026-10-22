import type { ClubScope, FeatureBackendContext } from './featureRouter';
import type { FeatureArea } from './featureBackend';
import { routingActive } from './generalActivation';
import { hasOwnerTestRouting } from './ownerTestRouting';

/** Composite feeds route each nested resource separately, never their whole context. */
type Dispatcher = typeof import('./featureRouter')['withFeatureBackend'];
export function createContentReader(active: (ctx: FeatureBackendContext) => boolean | Promise<boolean>, load: () => Promise<Dispatcher>) {
  return async <T>(ctx: FeatureBackendContext, feature: FeatureArea, scope: ClubScope, read: (context: FeatureBackendContext) => Promise<T>): Promise<T> => {
    if (!await active(ctx)) return read(ctx);
    const dispatch = await load();
    return dispatch(feature, { supabase: () => { throw new Error('ICP content read cannot fall back'); }, icp: read }, scope);
  };
}
export const readContentInScope = createContentReader(async ctx => await routingActive(ctx) || hasOwnerTestRouting(ctx),
  async () => (await import('./featureRouter')).withFeatureBackend);