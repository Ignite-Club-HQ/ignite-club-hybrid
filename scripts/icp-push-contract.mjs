/** Match notification_queue's canonical wire types; shared with local tests. */
export function createPushQueueIdl({ IDL }) {
  const status = IDL.Variant({ Pending: IDL.Null, Processing: IDL.Null, Delivered: IDL.Null, Failed: IDL.Null });
  const notification = IDL.Record({
    id: IDL.Text, user: IDL.Text, club: IDL.Text, kind: IDL.Text, body: IDL.Text,
    idempotency_key: IDL.Text, status, attempts: IDL.Nat32,
    next_attempt_ms: IDL.Nat64, read: IDL.Bool, related_id: IDL.Opt(IDL.Text), created_at_ms: IDL.Nat64,
  });
  const result = IDL.Variant({ Ok: notification, Err: IDL.Text });
  const resultNat16 = IDL.Variant({ Ok: IDL.Nat16, Err: IDL.Text });
  const token = IDL.Record({ user: IDL.Text, platform: IDL.Text, token: IDL.Text,
    p256dh: IDL.Opt(IDL.Text), auth: IDL.Opt(IDL.Text), updated_at_ms: IDL.Nat64 });
  return IDL.Service({
    recover: IDL.Func([], [resultNat16], []),
    claim: IDL.Func([IDL.Nat64, IDL.Nat16], [IDL.Variant({ Ok: IDL.Vec(notification), Err: IDL.Text })], []),
    authorize_delivery: IDL.Func([IDL.Text, IDL.Text], [IDL.Variant({ Ok: IDL.Bool, Err: IDL.Text })], []),
    acknowledge: IDL.Func([IDL.Text, IDL.Text], [result], []),
    fail: IDL.Func([IDL.Text, IDL.Text, IDL.Opt(IDL.Nat64)], [result], []),
    list_device_tokens: IDL.Func([IDL.Vec(IDL.Text)], [IDL.Variant({ Ok: IDL.Vec(token), Err: IDL.Text })], []),
    remove_device_tokens: IDL.Func([IDL.Text, IDL.Vec(IDL.Text)], [resultNat16], []),
  });
}

export function notificationKey(notification) {
  if (typeof notification.idempotency_key !== 'string') throw new Error('Invalid notification idempotency key');
  return notification.idempotency_key;
}