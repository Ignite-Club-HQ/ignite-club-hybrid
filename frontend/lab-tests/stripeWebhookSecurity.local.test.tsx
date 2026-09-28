/**
 * Local equivalent of the exported `stripeWebhook.security.test.ts` security +
 * reliability regression suite.
 *
 * Covers the confirmed defects the original guards against:
 *  1. Stripe cannot reach the webhook (verify_jwt must be false).
 *  2. Future-dated / malformed / stale signatures were accepted.
 *  3. Webhook retries were not idempotent (durable event ledger + atomic claim).
 *
 * The real handler imports `Deno.serve` + esm.sh modules and cannot run under
 * Vitest, so the signature module is exercised directly (via the local port
 * in `src/lab/edgeGuards/stripeSignature.ts`) and the handler's claim /
 * complete / fail / transition control flow is reproduced faithfully in a
 * synthetic in-memory harness — exactly as the exported source does. Schema
 * and handler-source assertions read the sanitized, inert
 * `reference/backend` copies as text only; nothing is executed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  verifyStripeSignature,
  signStripePayload,
  parseStripeTimestamp,
  parseStripeSignatureHeader,
  timingSafeEqual,
  STRIPE_SIGNATURE_TOLERANCE_SECONDS,
} from '../src/lab/edgeGuards/stripeSignature';

const SECRET = 'whsec_test_secret_value';
const NOW = 1_800_000_000;
const referenceRoot = path.resolve(__dirname, '../../reference/backend/supabase');

function extractSanitizedSource(mdText: string): string {
  const lines = mdText.split('\n');
  const openIndex = lines.findIndex((line) => /^`{4,}/.test(line));
  if (openIndex === -1) throw new Error('Missing fenced source block in reference markdown');
  const closeIndex = lines.findIndex(
    (line, index) => index > openIndex && /^`{4,}\s*$/.test(line),
  );
  if (closeIndex === -1) throw new Error('Unterminated fenced source block in reference markdown');
  return lines.slice(openIndex + 1, closeIndex).join('\n');
}

const readReference = (mdPath: string) => extractSanitizedSource(readFileSync(mdPath, 'utf8'));

const webhookSource = readReference(path.join(referenceRoot, 'functions/stripe-webhook/index.ts.md'));
const configToml = readReference(path.join(referenceRoot, 'config.toml.md'));
// Every migration that touches the Stripe webhook ledger / ordering machinery.
const migrationsDir = path.join(referenceRoot, 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql.md'))
  .sort()
  .filter((f) => readReference(path.join(migrationsDir, f)).includes('stripe_webhook_events'));
const migrations = migrationFiles.map((f) => readReference(path.join(migrationsDir, f))).join('\n');

// ---------------------------------------------------------------------------
// 1. Gateway configuration
// ---------------------------------------------------------------------------
describe('stripe-webhook gateway configuration', () => {
  it('is configured with verify_jwt = false so Stripe can reach it', () => {
    const block = configToml.match(/\[functions\.stripe-webhook\]\s*\n\s*verify_jwt\s*=\s*(\w+)/);
    expect(block).not.toBeNull();
    expect(block![1]).toBe('false');
  });

  it('still treats the handler as untrusted: signature verification is mandatory', () => {
    expect(webhookSource).toMatch(/verifyStripeSignature\(/);
    expect(webhookSource).toMatch(/status: 401/);
  });
});

// ---------------------------------------------------------------------------
// 2. Signature verification
// ---------------------------------------------------------------------------
describe('stripe signature verification', () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });

  it('fails closed when the webhook secret is missing', async () => {
    const res = await verifyStripeSignature(payload, 't=1,v1=aa', undefined, NOW);
    expect(res).toEqual({ valid: false, reason: 'missing_secret' });
  });

  it('rejects a missing signature header', async () => {
    const res = await verifyStripeSignature(payload, null, SECRET, NOW);
    expect(res).toEqual({ valid: false, reason: 'missing_signature' });
  });

  it('accepts a valid current signature', async () => {
    const header = await signStripePayload(payload, SECRET, NOW);
    expect(await verifyStripeSignature(payload, header, SECRET, NOW)).toEqual({ valid: true });
  });

  it('rejects an invalid signature for the same timestamp', async () => {
    const header = `t=${NOW},v1=${'ab'.repeat(32)}`;
    const res = await verifyStripeSignature(payload, header, SECRET, NOW);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('signature_mismatch');
  });

  it('verifies the exact raw body — a re-serialised body does not match', async () => {
    const header = await signStripePayload(payload, SECRET, NOW);
    const reserialised = JSON.stringify(JSON.parse(payload), null, 2);
    expect((await verifyStripeSignature(reserialised, header, SECRET, NOW)).valid).toBe(false);
  });

  it('rejects signatures older than 300 seconds', async () => {
    const header = await signStripePayload(payload, SECRET, NOW - 301);
    expect(await verifyStripeSignature(payload, header, SECRET, NOW)).toEqual({
      valid: false,
      reason: 'timestamp_out_of_tolerance',
    });
  });

  it('rejects signatures more than 300 seconds in the future', async () => {
    const header = await signStripePayload(payload, SECRET, NOW + 301);
    expect(await verifyStripeSignature(payload, header, SECRET, NOW)).toEqual({
      valid: false,
      reason: 'timestamp_out_of_tolerance',
    });
  });

  it('accepts signatures exactly at the tolerance boundary in both directions', async () => {
    for (const skew of [-STRIPE_SIGNATURE_TOLERANCE_SECONDS, STRIPE_SIGNATURE_TOLERANCE_SECONDS]) {
      const header = await signStripePayload(payload, SECRET, NOW + skew);
      expect((await verifyStripeSignature(payload, header, SECRET, NOW)).valid).toBe(true);
    }
  });

  it.each(['t=,v1=aa', 't=abc,v1=aa', 't=12abc,v1=aa', 't=1.5,v1=aa', 't=NaN,v1=aa', 't=Infinity,v1=aa', 'v1=aa'])(
    'rejects malformed timestamp header %s',
    async (header) => {
      const res = await verifyStripeSignature(payload, header, SECRET, NOW);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('malformed_timestamp');
    },
  );

  it('rejects a header with no v1 signature', async () => {
    const res = await verifyStripeSignature(payload, `t=${NOW}`, SECRET, NOW);
    expect(res).toEqual({ valid: false, reason: 'malformed_signature' });
  });

  it('accepts a header containing multiple v1 signatures when one is valid', async () => {
    const valid = await signStripePayload(payload, SECRET, NOW);
    const hex = valid.split('v1=')[1];
    const header = `t=${NOW},v1=${'cd'.repeat(32)},v1=${hex},v0=ignored`;
    expect((await verifyStripeSignature(payload, header, SECRET, NOW)).valid).toBe(true);
  });

  it('rejects when every v1 candidate is wrong', async () => {
    const header = `t=${NOW},v1=${'cd'.repeat(32)},v1=${'ef'.repeat(32)}`;
    expect((await verifyStripeSignature(payload, header, SECRET, NOW)).valid).toBe(false);
  });

  it('parses timestamps strictly and compares bytes in constant time', () => {
    expect(parseStripeTimestamp('100')).toBe(100);
    expect(parseStripeTimestamp('1e3')).toBeNull();
    expect(parseStripeSignatureHeader('t=5,v1=a,v1=b').v1).toEqual(['a', 'b']);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  it('never returns the secret, signature or payload in a failure reason', async () => {
    const header = `t=${NOW},v1=${'ab'.repeat(32)}`;
    const res = await verifyStripeSignature(payload, header, SECRET, NOW);
    const serialised = JSON.stringify(res);
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain('ab'.repeat(32));
    expect(serialised).not.toContain('invoice.paid');
  });
});

// ---------------------------------------------------------------------------
// 3. Idempotency ledger harness (mirrors the handler's control flow)
// ---------------------------------------------------------------------------
type LedgerStatus = 'processing' | 'completed' | 'failed';
interface LedgerRow {
  status: LedgerStatus;
  attempts: number;
  updatedAt: number;
}

class FakeLedgerDb {
  ledger = new Map<string, LedgerRow>();
  storage = new Map<string, number>();
  payments: any[] = [];
  notifications: any[] = [];
  now = 0;
  staleAfterMs = 15 * 60 * 1000;
  failNextBusinessMutation = false;

  claim(eventId: string): string {
    const existing = this.ledger.get(eventId);
    if (!existing) {
      this.ledger.set(eventId, { status: 'processing', attempts: 1, updatedAt: this.now });
      return 'claimed';
    }
    if (existing.status === 'completed') return 'duplicate_completed';
    if (existing.status === 'processing' && existing.updatedAt > this.now - this.staleAfterMs) {
      return 'in_progress';
    }
    existing.status = 'processing';
    existing.attempts += 1;
    existing.updatedAt = this.now;
    return 'claimed';
  }

  complete(eventId: string) {
    const row = this.ledger.get(eventId);
    if (row) {
      row.status = 'completed';
      row.updatedAt = this.now;
    }
  }

  fail(eventId: string, error: string) {
    const row = this.ledger.get(eventId);
    if (row) {
      row.status = 'failed';
      row.updatedAt = this.now;
      (row as any).lastError = error.slice(0, 300);
    }
  }

  /** Mirrors apply_stripe_storage_addon: increment + notify + complete atomically. */
  applyStorageAddon(eventId: string, clubId: string, gb: number, userId: string) {
    const row = this.ledger.get(eventId);
    if (!row) throw new Error('stripe event not claimed');
    if (row.status === 'completed') return 'already_applied';

    const snapshotStorage = new Map(this.storage);
    const snapshotNotifications = [...this.notifications];
    try {
      this.storage.set(clubId, (this.storage.get(clubId) ?? 0) + gb);
      this.notifications.push({ userId, type: 'storage_purchased', clubId, gb });
      if (this.failNextBusinessMutation) {
        this.failNextBusinessMutation = false;
        throw new Error('db failure mid-transaction');
      }
      row.status = 'completed';
      row.updatedAt = this.now;
      return 'applied';
    } catch (e) {
      // Transactional rollback.
      this.storage = snapshotStorage;
      this.notifications = snapshotNotifications;
      throw e;
    }
  }
}

/** Faithful reproduction of the handler's claim → mutate → complete/fail flow. */
async function processEvent(db: FakeLedgerDb, event: any) {
  const eventId: string | null = typeof event?.id === 'string' ? event.id : null;
  let claimed = false;
  let selfCompleted = false;

  if (eventId) {
    const result = db.claim(eventId);
    if (result === 'duplicate_completed') return { status: 200, duplicate: true };
    if (result === 'in_progress') return { status: 409 };
    claimed = true;
  }

  try {
    const meta = event?.data?.object?.metadata ?? {};
    if (event.type === 'checkout.session.completed' && meta.type === 'storage_addon') {
      db.applyStorageAddon(eventId!, meta.club_id, Number(meta.storage_gb), meta.user_id);
      selfCompleted = true;
    } else if (event.type === 'checkout.session.completed' && meta.type === 'event_payment') {
      const exists = db.payments.some((p) => p.eventId === meta.event_id && p.userId === meta.user_id);
      if (!exists) {
        db.payments.push({ eventId: meta.event_id, userId: meta.user_id });
        db.notifications.push({ userId: meta.user_id, type: 'payment_confirmed' });
      }
    } else if (event.type === 'some.unknown.event') {
      // Unknown events: acknowledged with no mutations.
    } else if (event.type === 'boom') {
      throw new Error('retriable processing failure');
    }

    if (claimed && !selfCompleted) db.complete(eventId!);
    return { status: 200 };
  } catch (e: any) {
    if (claimed) db.fail(eventId!, e.message);
    return { status: 500 };
  }
}

describe('stripe webhook idempotency ledger', () => {
  const storageEvent = (id: string) => ({
    id,
    type: 'checkout.session.completed',
    data: {
      object: {
        metadata: { type: 'storage_addon', club_id: 'club-1', storage_gb: '50', user_id: 'u1' },
      },
    },
  });

  it('duplicate delivery of the same event id does not repeat mutations', async () => {
    const db = new FakeLedgerDb();
    const first = await processEvent(db, storageEvent('evt_1'));
    const second = await processEvent(db, storageEvent('evt_1'));
    expect(first.status).toBe(200);
    expect(second).toEqual({ status: 200, duplicate: true });
    expect(db.storage.get('club-1')).toBe(50);
    expect(db.notifications).toHaveLength(1);
  });

  it('storage add-ons increment exactly once across many retries', async () => {
    const db = new FakeLedgerDb();
    for (let i = 0; i < 5; i++) await processEvent(db, storageEvent('evt_storage'));
    expect(db.storage.get('club-1')).toBe(50);
  });

  it('concurrent duplicate deliveries permit only one processor', () => {
    const db = new FakeLedgerDb();
    expect(db.claim('evt_c')).toBe('claimed');
    expect(db.claim('evt_c')).toBe('in_progress');
    expect(db.claim('evt_c')).toBe('in_progress');
  });

  it('a failed attempt can be retried safely and then completes', async () => {
    const db = new FakeLedgerDb();
    db.failNextBusinessMutation = true;
    const failed = await processEvent(db, storageEvent('evt_retry'));
    expect(failed.status).toBe(500);
    expect(db.ledger.get('evt_retry')!.status).toBe('failed');
    // Partial database failure must not leave a completed ledger record.
    expect(db.storage.get('club-1')).toBeUndefined();
    expect(db.notifications).toHaveLength(0);

    const retried = await processEvent(db, storageEvent('evt_retry'));
    expect(retried.status).toBe(200);
    expect(db.ledger.get('evt_retry')!.status).toBe('completed');
    expect(db.ledger.get('evt_retry')!.attempts).toBe(2);
    expect(db.storage.get('club-1')).toBe(50);
  });

  it('a stale processing claim is reclaimable so events never get stuck', () => {
    const db = new FakeLedgerDb();
    expect(db.claim('evt_stale')).toBe('claimed');
    db.now += 16 * 60 * 1000;
    expect(db.claim('evt_stale')).toBe('claimed');
  });

  it('event payments and their notifications are recorded exactly once', async () => {
    const db = new FakeLedgerDb();
    const ev = {
      id: 'evt_pay',
      type: 'checkout.session.completed',
      data: { object: { metadata: { type: 'event_payment', event_id: 'e1', user_id: 'u1' } } },
    };
    await processEvent(db, ev);
    await processEvent(db, ev);
    expect(db.payments).toHaveLength(1);
    expect(db.notifications.filter((n) => n.type === 'payment_confirmed')).toHaveLength(1);
  });

  it('unknown event types are acknowledged with no mutations', async () => {
    const db = new FakeLedgerDb();
    const res = await processEvent(db, { id: 'evt_unknown', type: 'some.unknown.event' });
    expect(res.status).toBe(200);
    expect(db.storage.size).toBe(0);
    expect(db.notifications).toHaveLength(0);
  });

  it('retriable processing failures return non-2xx so Stripe retries', async () => {
    const db = new FakeLedgerDb();
    const res = await processEvent(db, { id: 'evt_boom', type: 'boom' });
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 4. Out-of-order safety + ledger lockdown (asserted against the migration SQL)
// ---------------------------------------------------------------------------
describe('stripe webhook ledger schema and out-of-order safety', () => {
  it('creates a ledger with a database-enforced unique event id and status set', () => {
    expect(migrations).toMatch(/stripe_event_id text PRIMARY KEY/);
    expect(migrations).toMatch(/status IN \('processing', 'completed', 'failed'\)/);
    expect(migrations).toMatch(/attempts integer NOT NULL DEFAULT 0/);
    expect(migrations).toMatch(/completed_at timestamptz/);
    expect(migrations).toMatch(/last_error text/);
    expect(migrations).toMatch(/stripe_object_id text/);
  });

  it('keeps the ledger and its RPCs inaccessible to anon and authenticated', () => {
    expect(migrations).toMatch(/REVOKE ALL ON public\.stripe_webhook_events FROM authenticated/);
    expect(migrations).toMatch(/REVOKE ALL ON public\.stripe_webhook_events FROM anon/);
    expect(migrations).toMatch(/ALTER TABLE public\.stripe_webhook_events ENABLE ROW LEVEL SECURITY/);
    for (const fn of [
      'claim_stripe_webhook_event',
      'complete_stripe_webhook_event',
      'fail_stripe_webhook_event',
      'apply_stripe_storage_addon',
    ]) {
      expect(migrations).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`),
      );
      expect(migrations).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`),
      );
    }
  });

  it('sets a safe search_path on every SECURITY DEFINER function', () => {
    const definerBlocks = migrations.split('SECURITY DEFINER').slice(1);
    expect(definerBlocks.length).toBeGreaterThan(0);
    for (const block of definerBlocks) {
      expect(block.slice(0, 200)).toMatch(/SET search_path = public, pg_temp/);
    }
  });

  it('records the last applied Stripe event so older events cannot overwrite newer state', () => {
    expect(migrations).toMatch(/last_stripe_event_id text/);
    expect(migrations).toMatch(/last_stripe_event_at timestamptz/);
    // Ordering is enforced inside a single transactional RPC.
    expect(migrations).toMatch(/CREATE TABLE IF NOT EXISTS public\.stripe_subscription_event_state/);
    expect(migrations).toMatch(/stripe_subscription_id text PRIMARY KEY/);
    expect(migrations).toMatch(/FOR UPDATE/);
    expect(webhookSource).toMatch(/apply_stripe_subscription_transition/);
    expect(webhookSource).toMatch(/Skipping out-of-order/);
    // Every entitlement transition goes through the ordered RPC.
    for (const transition of ["'activate'", "'renew'", "'update'", "'cancel'"]) {
      expect(webhookSource).toContain(`transition: ${transition}`);
    }
  });

  it('does not store webhook secrets or full Stripe payloads in the ledger', () => {
    expect(migrations).not.toMatch(/whsec_/);
    expect(migrations).not.toMatch(/payload jsonb|raw_body|event_payload/);
  });
});

// ---------------------------------------------------------------------------
// 5. Production-path acceptance: completion failure, fail-closed ordering,
//    activation ordering and durable cancellation watermarks.
// ---------------------------------------------------------------------------

type Transition = 'activate' | 'renew' | 'update' | 'cancel';

interface StateRow {
  entityType: 'club' | 'team' | null;
  entityId: string | null;
  lastEventId: string;
  lastEventAt: number;
  subscriptionState: 'active' | 'cancelled';
}

/**
 * Faithful model of `apply_stripe_subscription_transition` +
 * `complete_stripe_webhook_event`, including the transactional boundary.
 */
class FakeSubscriptionDb {
  ledger = new Map<string, { status: LedgerStatus; attempts: number; updatedAt: number }>();
  state = new Map<string, StateRow>();
  outbox = new Set<string>();
  notifications: any[] = [];
  clubSubs = new Map<string, { isPro: boolean; stripeSubscriptionId: string | null }>();
  teamSubs = new Map<string, { isPro: boolean; stripeSubscriptionId: string | null }>();
  now = 0;

  // Fault injection
  failTransitionRpc = false;
  failCompletionRpc = false;
  failMidTransaction = false;

  claim(eventId: string): string {
    const existing = this.ledger.get(eventId);
    if (!existing) {
      this.ledger.set(eventId, { status: 'processing', attempts: 1, updatedAt: this.now });
      return 'claimed';
    }
    if (existing.status === 'completed') return 'duplicate_completed';
    if (existing.status === 'processing' && existing.updatedAt > this.now - 15 * 60 * 1000) {
      return 'in_progress';
    }
    existing.status = 'processing';
    existing.attempts += 1;
    return 'claimed';
  }

  complete(eventId: string) {
    if (this.failCompletionRpc) return { error: { message: 'ledger write failed' } };
    const row = this.ledger.get(eventId);
    if (row) row.status = 'completed';
    return { error: null };
  }

  fail(eventId: string) {
    const row = this.ledger.get(eventId);
    if (row) row.status = 'failed';
  }

  applyTransition(args: {
    eventId: string;
    eventAt: number;
    subscriptionId: string;
    transition: Transition;
    entityType?: 'club' | 'team' | null;
    entityId?: string | null;
    ownerUserId?: string | null;
  }): { data: any; error: any } {
    if (this.failTransitionRpc) return { data: null, error: { message: 'rpc failed' } };

    const ledgerRow = this.ledger.get(args.eventId);
    if (!ledgerRow) return { data: null, error: { message: 'stripe event not claimed' } };
    if (ledgerRow.status === 'completed') return { data: { result: 'already_applied' }, error: null };

    // Transaction snapshot for rollback.
    const snapshot = {
      state: new Map([...this.state].map(([k, v]) => [k, { ...v }])),
      outbox: new Set(this.outbox),
      notifications: [...this.notifications],
      clubSubs: new Map([...this.clubSubs].map(([k, v]) => [k, { ...v }])),
      teamSubs: new Map([...this.teamSubs].map(([k, v]) => [k, { ...v }])),
      ledgerStatus: ledgerRow.status,
    };

    try {
      const prior = this.state.get(args.subscriptionId);

      if (prior) {
        if (prior.lastEventId === args.eventId) {
          ledgerRow.status = 'completed';
          return { data: { result: 'already_applied' }, error: null };
        }
        const older =
          prior.lastEventAt > args.eventAt ||
          (prior.lastEventAt === args.eventAt && args.eventId <= prior.lastEventId);
        if (older) {
          ledgerRow.status = 'completed';
          return { data: { result: 'stale' }, error: null };
        }
      }

      const entityType = args.entityType ?? prior?.entityType ?? null;
      const entityId = args.entityId ?? prior?.entityId ?? null;

      if (entityType && entityId) {
        const table = entityType === 'club' ? this.clubSubs : this.teamSubs;
        if (args.transition === 'cancel') {
          // Club cancellation deletes the row; team cancellation clears the id.
          if (entityType === 'club') table.delete(entityId);
          else table.set(entityId, { isPro: false, stripeSubscriptionId: null });
        } else {
          table.set(entityId, { isPro: true, stripeSubscriptionId: args.subscriptionId });
        }
      }

      if (this.failMidTransaction) {
        this.failMidTransaction = false;
        throw new Error('db failure mid-transaction');
      }

      // Durable watermark — survives row deletion / id clearing.
      this.state.set(args.subscriptionId, {
        entityType,
        entityId,
        lastEventId: args.eventId,
        lastEventAt: args.eventAt,
        subscriptionState: args.transition === 'cancel' ? 'cancelled' : 'active',
      });

      const purpose =
        args.transition === 'activate'
          ? 'subscription_activated'
          : args.transition === 'renew'
            ? 'subscription_renewed'
            : args.transition === 'cancel'
              ? 'subscription_cancelled'
              : null;
      if (purpose && args.ownerUserId) {
        const key = `${args.eventId}:${purpose}`;
        if (!this.outbox.has(key)) {
          this.outbox.add(key);
          this.notifications.push({ userId: args.ownerUserId, type: purpose });
        }
      }

      ledgerRow.status = 'completed';
      return { data: { result: 'applied', entity_type: entityType, entity_id: entityId }, error: null };
    } catch (e) {
      this.state = snapshot.state;
      this.outbox = snapshot.outbox;
      this.notifications = snapshot.notifications;
      this.clubSubs = snapshot.clubSubs;
      this.teamSubs = snapshot.teamSubs;
      ledgerRow.status = snapshot.ledgerStatus;
      throw e;
    }
  }
}

/** Mirrors the hardened handler control flow. */
function handleWebhook(
  db: FakeSubscriptionDb,
  ev: {
    id: string;
    eventAt: number;
    transition?: Transition;
    subscriptionId?: string;
    entityType?: 'club' | 'team' | null;
    entityId?: string | null;
    ownerUserId?: string | null;
    nonTransactional?: boolean;
  },
): { status: number; body: any } {
  const claim = db.claim(ev.id);
  if (claim === 'duplicate_completed') return { status: 200, body: { received: true, duplicate: true } };
  if (claim === 'in_progress') return { status: 409, body: { error: 'Event already being processed' } };

  let ledgerCompletedInTransaction = false;
  try {
    if (ev.transition) {
      if (!ev.subscriptionId || !ev.id || ev.eventAt == null) {
        throw new Error('subscription_transition_ordering_unavailable');
      }
      const { data, error } = db.applyTransition({
        eventId: ev.id,
        eventAt: ev.eventAt,
        subscriptionId: ev.subscriptionId,
        transition: ev.transition,
        entityType: ev.entityType,
        entityId: ev.entityId,
        ownerUserId: ev.ownerUserId,
      });
      if (error) throw new Error('subscription_transition_failed'); // fail closed
      ledgerCompletedInTransaction = true;
      void data;
    }

    if (!ledgerCompletedInTransaction) {
      const { error } = db.complete(ev.id);
      if (error) throw new Error('ledger_completion_failed');
    }
    return { status: 200, body: { received: true } };
  } catch {
    db.fail(ev.id);
    return { status: 500, body: { error: 'Webhook processing failed' } };
  }
}

describe('stripe webhook production-path defects', () => {
  const SUB = 'sub_123';

  it('1+2. completion RPC failure returns non-2xx and never acknowledges', () => {
    const db = new FakeSubscriptionDb();
    db.failCompletionRpc = true;
    const res = handleWebhook(db, { id: 'evt_c1', eventAt: 100, nonTransactional: true });
    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty('received');
    expect(db.ledger.get('evt_c1')!.status).toBe('failed');
  });

  it('3+4. ordering-RPC failure performs no entitlement mutation and is retriable', () => {
    const db = new FakeSubscriptionDb();
    db.failTransitionRpc = true;
    const res = handleWebhook(db, {
      id: 'evt_o1', eventAt: 100, transition: 'activate',
      subscriptionId: SUB, entityType: 'club', entityId: 'club-1', ownerUserId: 'u1',
    });
    expect(res.status).toBe(500);
    expect(db.clubSubs.size).toBe(0);
    expect(db.state.size).toBe(0);
    expect(db.notifications).toHaveLength(0);

    // Retriable: the same event succeeds once the RPC recovers.
    db.failTransitionRpc = false;
    const retry = handleWebhook(db, {
      id: 'evt_o1', eventAt: 100, transition: 'activate',
      subscriptionId: SUB, entityType: 'club', entityId: 'club-1', ownerUserId: 'u1',
    });
    expect(retry.status).toBe(200);
    expect(db.clubSubs.get('club-1')!.isPro).toBe(true);
  });

  it('5. an older activation arriving after a newer cancellation is ignored', () => {
    const db = new FakeSubscriptionDb();
    db.clubSubs.set('club-1', { isPro: true, stripeSubscriptionId: SUB });
    handleWebhook(db, { id: 'evt_cancel', eventAt: 500, transition: 'cancel', subscriptionId: SUB, entityType: 'club', entityId: 'club-1', ownerUserId: 'u1' });
    expect(db.clubSubs.has('club-1')).toBe(false);

    const late = handleWebhook(db, { id: 'evt_activate', eventAt: 400, transition: 'activate', subscriptionId: SUB, entityType: 'club', entityId: 'club-1', ownerUserId: 'u1' });
    expect(late.status).toBe(200);
    expect(db.clubSubs.has('club-1')).toBe(false);
    expect(db.state.get(SUB)!.subscriptionState).toBe('cancelled');
  });

  it('6. an older renewal arriving after a newer cancellation is ignored', () => {
    const db = new FakeSubscriptionDb();
    db.teamSubs.set('team-1', { isPro: true, stripeSubscriptionId: SUB });
    handleWebhook(db, { id: 'evt_cancel', eventAt: 500, transition: 'cancel', subscriptionId: SUB, entityType: 'team', entityId: 'team-1', ownerUserId: 'u1' });
    handleWebhook(db, { id: 'evt_renew', eventAt: 450, transition: 'renew', subscriptionId: SUB, entityType: 'team', entityId: 'team-1' });
    expect(db.teamSubs.get('team-1')).toEqual({ isPro: false, stripeSubscriptionId: null });
  });

  it('7. an older update arriving after a newer cancellation is ignored', () => {
    const db = new FakeSubscriptionDb();
    db.clubSubs.set('club-1', { isPro: true, stripeSubscriptionId: SUB });
    handleWebhook(db, { id: 'evt_cancel', eventAt: 500, transition: 'cancel', subscriptionId: SUB, entityType: 'club', entityId: 'club-1' });
    handleWebhook(db, { id: 'evt_update', eventAt: 499, transition: 'update', subscriptionId: SUB });
    expect(db.clubSubs.has('club-1')).toBe(false);
  });

  it('8. a newer legitimate reactivation after cancellation succeeds', () => {
    const db = new FakeSubscriptionDb();
    db.clubSubs.set('club-1', { isPro: true, stripeSubscriptionId: SUB });
    handleWebhook(db, { id: 'evt_cancel', eventAt: 500, transition: 'cancel', subscriptionId: SUB, entityType: 'club', entityId: 'club-1' });
    const res = handleWebhook(db, { id: 'evt_reactivate', eventAt: 900, transition: 'activate', subscriptionId: SUB, entityType: 'club', entityId: 'club-1', ownerUserId: 'u1' });
    expect(res.status).toBe(200);
    expect(db.clubSubs.get('club-1')!.isPro).toBe(true);
    expect(db.state.get(SUB)!.subscriptionState).toBe('active');
  });

  it('9. club cancellation retains a durable watermark after the row is deleted', () => {
    const db = new FakeSubscriptionDb();
    db.clubSubs.set('club-1', { isPro: true, stripeSubscriptionId: SUB });
    handleWebhook(db, { id: 'evt_cancel', eventAt: 500, transition: 'cancel', subscriptionId: SUB, entityType: 'club', entityId: 'club-1' });
    expect(db.clubSubs.has('club-1')).toBe(false);
    expect(db.state.get(SUB)).toMatchObject({ lastEventAt: 500, subscriptionState: 'cancelled', entityId: 'club-1' });
  });

  it('10. team cancellation retains a durable watermark after its Stripe id is cleared', () => {
    const db = new FakeSubscriptionDb();
    db.teamSubs.set('team-1', { isPro: true, stripeSubscriptionId: SUB });
    handleWebhook(db, { id: 'evt_cancel', eventAt: 500, transition: 'cancel', subscriptionId: SUB, entityType: 'team', entityId: 'team-1' });
    expect(db.teamSubs.get('team-1')!.stripeSubscriptionId).toBeNull();
    expect(db.state.get(SUB)!.lastEventAt).toBe(500);
  });

  it('11. concurrent cancellation and renewal serialize deterministically', () => {
    const db = new FakeSubscriptionDb();
    db.clubSubs.set('club-1', { isPro: true, stripeSubscriptionId: SUB });
    // Cancellation is newer; whichever order they arrive, cancellation wins.
    handleWebhook(db, { id: 'evt_renew', eventAt: 400, transition: 'renew', subscriptionId: SUB, entityType: 'club', entityId: 'club-1' });
    handleWebhook(db, { id: 'evt_cancel', eventAt: 500, transition: 'cancel', subscriptionId: SUB, entityType: 'club', entityId: 'club-1' });
    expect(db.clubSubs.has('club-1')).toBe(false);

    const db2 = new FakeSubscriptionDb();
    db2.clubSubs.set('club-1', { isPro: true, stripeSubscriptionId: SUB });
    handleWebhook(db2, { id: 'evt_cancel', eventAt: 500, transition: 'cancel', subscriptionId: SUB, entityType: 'club', entityId: 'club-1' });
    handleWebhook(db2, { id: 'evt_renew', eventAt: 400, transition: 'renew', subscriptionId: SUB, entityType: 'club', entityId: 'club-1' });
    expect(db2.clubSubs.has('club-1')).toBe(false);
  });

  it('12. equal-timestamp duplicate delivery does not apply twice', () => {
    const db = new FakeSubscriptionDb();
    const ev = { eventAt: 500, transition: 'activate' as Transition, subscriptionId: SUB, entityType: 'club' as const, entityId: 'club-1', ownerUserId: 'u1' };
    handleWebhook(db, { id: 'evt_same', ...ev });
    const again = handleWebhook(db, { id: 'evt_same', ...ev });
    expect(again.body).toEqual({ received: true, duplicate: true });
    expect(db.notifications).toHaveLength(1);

    // A different event at the exact same timestamp uses a deterministic
    // tie-break, so it can never be applied twice in both orders.
    const lower = handleWebhook(db, { id: 'evt_aaa', ...ev, transition: 'cancel' });
    expect(lower.status).toBe(200);
    expect(db.clubSubs.get('club-1')!.isPro).toBe(true); // tie-break rejected the older id
  });

  it('13. team and club transitions remain isolated from each other', () => {
    const db = new FakeSubscriptionDb();
    handleWebhook(db, { id: 'evt_team', eventAt: 100, transition: 'activate', subscriptionId: 'sub_team', entityType: 'team', entityId: 'team-1', ownerUserId: 'u1' });
    handleWebhook(db, { id: 'evt_club_cancel', eventAt: 200, transition: 'cancel', subscriptionId: 'sub_club', entityType: 'club', entityId: 'club-1' });
    expect(db.teamSubs.get('team-1')!.isPro).toBe(true);
    expect(db.state.get('sub_team')!.subscriptionState).toBe('active');
    expect(db.state.get('sub_club')!.subscriptionState).toBe('cancelled');
  });

  it('14. notification/outbox creation occurs once per Stripe event', () => {
    const db = new FakeSubscriptionDb();
    const ev = { id: 'evt_n', eventAt: 100, transition: 'activate' as Transition, subscriptionId: SUB, entityType: 'club' as const, entityId: 'club-1', ownerUserId: 'u1' };
    handleWebhook(db, ev);
    handleWebhook(db, ev);
    handleWebhook(db, ev);
    expect(db.notifications).toHaveLength(1);
    expect(db.outbox.size).toBe(1);
  });

  it('15+16. partial failure rolls back entitlement, watermark and ledger together', () => {
    const db = new FakeSubscriptionDb();
    db.failMidTransaction = true;
    const res = handleWebhook(db, { id: 'evt_partial', eventAt: 100, transition: 'activate', subscriptionId: SUB, entityType: 'club', entityId: 'club-1', ownerUserId: 'u1' });
    expect(res.status).toBe(500);
    expect(db.clubSubs.size).toBe(0);
    expect(db.state.size).toBe(0);
    expect(db.notifications).toHaveLength(0);
    expect(db.ledger.get('evt_partial')!.status).toBe('failed');

    // The critical transition and the ledger completion commit together.
    const retry = handleWebhook(db, { id: 'evt_partial', eventAt: 100, transition: 'activate', subscriptionId: SUB, entityType: 'club', entityId: 'club-1', ownerUserId: 'u1' });
    expect(retry.status).toBe(200);
    expect(db.ledger.get('evt_partial')!.status).toBe('completed');
    expect(db.clubSubs.get('club-1')!.isPro).toBe(true);
  });

  it('17. the new tables and RPC are inaccessible to anon and authenticated', () => {
    for (const table of ['stripe_subscription_event_state', 'stripe_notification_outbox']) {
      expect(migrations).toMatch(new RegExp(`REVOKE ALL ON public\\.${table} FROM anon`));
      expect(migrations).toMatch(new RegExp(`REVOKE ALL ON public\\.${table} FROM authenticated`));
      expect(migrations).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
      expect(migrations).toMatch(new RegExp(`GRANT ALL ON public\\.${table} TO service_role`));
    }
    expect(migrations).toMatch(
      /REVOKE ALL ON FUNCTION public\.apply_stripe_subscription_transition\([^)]*\) FROM PUBLIC, anon, authenticated/,
    );
    expect(migrations).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.apply_stripe_subscription_transition\([^)]*\) TO service_role/,
    );
    // No client-facing policies exist on either table.
    expect(migrations).not.toMatch(/CREATE POLICY[^;]*stripe_subscription_event_state/);
    expect(migrations).not.toMatch(/CREATE POLICY[^;]*stripe_notification_outbox/);
  });

  it('19. no payload, signature, secret or database error detail reaches responses', () => {
    const db = new FakeSubscriptionDb();
    db.failTransitionRpc = true;
    const res = handleWebhook(db, { id: 'evt_leak', eventAt: 1, transition: 'activate', subscriptionId: SUB, entityType: 'club', entityId: 'club-1' });
    expect(res.body).toEqual({ error: 'Webhook processing failed' });
    expect(webhookSource).not.toMatch(/JSON\.stringify\(\{\s*error:\s*(error|err)\b/);
    expect(webhookSource).toMatch(/error: 'Webhook processing failed'/);
  });

  it('20. storage add-on exactly-once behaviour is unchanged', () => {
    expect(webhookSource).toMatch(/apply_stripe_storage_addon/);
    expect(migrations).toMatch(/CREATE OR REPLACE FUNCTION public\.apply_stripe_storage_addon/);
  });

  it('fails closed when ordering inputs are missing rather than mutating blind', () => {
    const db = new FakeSubscriptionDb();
    const res = handleWebhook(db, { id: 'evt_noSub', eventAt: 100, transition: 'activate', entityType: 'club', entityId: 'club-1' } as any);
    expect(res.status).toBe(500);
    expect(db.clubSubs.size).toBe(0);
    expect(webhookSource).toMatch(/subscription_transition_ordering_unavailable/);
  });
});
