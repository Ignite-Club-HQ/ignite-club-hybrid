import type { FeatureBackendContext } from "@/live/featureRouter";
import type { LiveEventInput } from "@/live/features/events";
type Store = Pick<Storage, "getItem" | "setItem">;
type Progress = { requestId: string; status: "unknown" | "complete"; eventIds?: string[] };
/** A transport failure is not proof of rejection: never replay an unknown row. */
export async function importIcpFixtureOnce(ctx: FeatureBackendContext, input: LiveEventInput, reminderHours: number | null,
  create: (requestId: string) => Promise<string[]>, store: Store = localStorage) {
  const service = ctx.target.canisterIds.events_domain;
  if (!service) throw new Error("Events service is not configured");
  const payload = JSON.stringify([input, reminderHours]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  const key = "ignite.fixture-import.v1:" + JSON.stringify([ctx.identity.getPrincipal().toText(), ctx.target.host, ctx.target.networkKind, service, input.clubId, input.teamId, hash]);
  const raw = store.getItem(key);
  if (raw) {
    const saved = JSON.parse(raw) as Progress;
    if (saved.status === "complete" && Array.isArray(saved.eventIds)) return saved.eventIds;
    throw new Error("A previous fixture import is unconfirmed. Check the schedule before making another import.");
  }
  const pending: Progress = { requestId: crypto.randomUUID(), status: "unknown" };
  const encoded = JSON.stringify(pending);
  store.setItem(key, encoded);
  if (store.getItem(key) !== encoded) throw new Error("Cannot save import progress; no fixture was sent.");
  try {
    const eventIds = await create(pending.requestId);
    const completed = JSON.stringify({ ...pending, status: "complete", eventIds });
    store.setItem(key, completed);
    if (store.getItem(key) !== completed) throw new Error("Import acknowledgement could not be saved");
    return eventIds;
  } catch {
    throw new Error("The fixture import is unconfirmed. Completed rows are saved; do not repeat this import until the schedule is checked.");
  }
}