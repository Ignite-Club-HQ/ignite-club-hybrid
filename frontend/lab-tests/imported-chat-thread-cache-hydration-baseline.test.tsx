import { expect, test } from 'vitest';
import {
  mergeOlderChatMessagesChronologically,
  orderChatMessagesChronologically,
  prependStrictlyOlderChatMessages,
} from '../src/lab/chatMessageOrdering';
import {
  mergeCachedChatMessagesChronologically,
  selectHistoryChatPlaceholderSource,
} from '../src/lab/chatThreadCacheHydration';

// This module is pure/provider-neutral: it only orders and merges
// already-fetched message rows and never talks to Supabase or ICP, so these
// tests exercise the contract directly rather than through backend routing.

test('orders older messages before newer messages', () => {
  const result = orderChatMessagesChronologically([
    { id: 'newer', created_at: '2026-08-04T10:01:00.000Z' },
    { id: 'older', created_at: '2026-08-04T10:00:00.000Z' },
  ]);

  expect(result.map((message) => message.id)).toEqual(['older', 'newer']);
});

test('uses immutable message id to make equal timestamps deterministic', () => {
  const created_at = '2026-08-04T10:00:00.000Z';

  expect(
    orderChatMessagesChronologically([
      { id: 'message-b', created_at },
      { id: 'message-a', created_at },
    ]).map((message) => message.id),
  ).toEqual(['message-a', 'message-b']);
});

test('retains the id fallback ordering when timestamps are invalid', () => {
  expect(
    orderChatMessagesChronologically([
      { id: 'message-b', created_at: 'invalid' },
      { id: 'message-a', created_at: 'invalid' },
    ]).map((message) => message.id),
  ).toEqual(['message-a', 'message-b']);
});

test('does not mutate the query-owned input array', () => {
  const messages = [
    { id: 'newer', created_at: '2026-08-04T10:01:00.000Z' },
    { id: 'older', created_at: '2026-08-04T10:00:00.000Z' },
  ];

  const result = orderChatMessagesChronologically(messages);

  expect(result).not.toBe(messages);
  expect(messages.map((message) => message.id)).toEqual(['newer', 'older']);
});

test('prependStrictlyOlderChatMessages preserves page order without reordering', () => {
  expect(
    prependStrictlyOlderChatMessages(
      [{ id: 'older-a' }, { id: 'older-b' }],
      [{ id: 'current-a' }, { id: 'current-b' }],
    ).map((message) => message.id),
  ).toEqual(['older-a', 'older-b', 'current-a', 'current-b']);
});

test('prependStrictlyOlderChatMessages intentionally preserves repeated ids across the strict page boundary', () => {
  expect(
    prependStrictlyOlderChatMessages(
      [{ id: 'repeated', source: 'older' }],
      [{ id: 'repeated', source: 'current' }],
    ),
  ).toEqual([
    { id: 'repeated', source: 'older' },
    { id: 'repeated', source: 'current' },
  ]);
});

test('prependStrictlyOlderChatMessages supports an absent current page without returning an input reference', () => {
  const older = [{ id: 'older' }];
  const result = prependStrictlyOlderChatMessages(older, undefined);

  expect(result).toEqual(older);
  expect(result).not.toBe(older);
});

test('mergeOlderChatMessagesChronologically prepends an older page in chronological order', () => {
  const result = mergeOlderChatMessagesChronologically(
    [
      { id: 'oldest', created_at: '2026-08-04T09:58:00.000Z' },
      { id: 'older', created_at: '2026-08-04T09:59:00.000Z' },
    ],
    [{ id: 'current', created_at: '2026-08-04T10:00:00.000Z' }],
  );

  expect(result.map((message) => message.id)).toEqual(['oldest', 'older', 'current']);
});

test('mergeOlderChatMessagesChronologically keeps current in-memory state when the page boundary repeats an id', () => {
  const result = mergeOlderChatMessagesChronologically(
    [{ id: 'boundary', created_at: '2026-08-04T09:59:00.000Z', text: 'stale' }],
    [{ id: 'boundary', created_at: '2026-08-04T09:59:00.000Z', text: 'realtime edit' }],
  );

  expect(result).toEqual([
    { id: 'boundary', created_at: '2026-08-04T09:59:00.000Z', text: 'realtime edit' },
  ]);
});

test('mergeOlderChatMessagesChronologically does not mutate either input collection', () => {
  const older = [{ id: 'older', created_at: '2026-08-04T09:59:00.000Z' }];
  const current = [{ id: 'current', created_at: '2026-08-04T10:00:00.000Z' }];

  const result = mergeOlderChatMessagesChronologically(older, current);

  expect(result).not.toBe(older);
  expect(result).not.toBe(current);
  expect(older.map((message) => message.id)).toEqual(['older']);
  expect(current.map((message) => message.id)).toEqual(['current']);
});

test('mergeOlderChatMessagesChronologically supports an absent current page', () => {
  expect(
    mergeOlderChatMessagesChronologically(
      [{ id: 'older', created_at: '2026-08-04T09:59:00.000Z' }],
      undefined,
    ).map((message) => message.id),
  ).toEqual(['older']);
});

test('mergeCachedChatMessagesChronologically adds cached rows missing from the query snapshot and orders the result', () => {
  const result = mergeCachedChatMessagesChronologically(
    [{ id: 'existing', created_at: '2026-08-04T10:00:00.000Z' }],
    [{ id: 'cached-older', created_at: '2026-08-04T09:59:00.000Z' }],
  );

  expect(result.map((message) => message.id)).toEqual(['cached-older', 'existing']);
});

test('mergeCachedChatMessagesChronologically keeps the existing query row when cache contains the same id', () => {
  const result = mergeCachedChatMessagesChronologically(
    [{ id: 'same', created_at: '2026-08-04T10:00:00.000Z', text: 'query' }],
    [{ id: 'same', created_at: '2026-08-04T10:00:00.000Z', text: 'cache' }],
  );

  expect(result).toEqual([{ id: 'same', created_at: '2026-08-04T10:00:00.000Z', text: 'query' }]);
});

test('mergeCachedChatMessagesChronologically does not mutate query-owned or cache-owned arrays', () => {
  const existing = [{ id: 'existing', created_at: '2026-08-04T10:00:00.000Z' }];
  const cached = [{ id: 'cached', created_at: '2026-08-04T09:59:00.000Z' }];

  const result = mergeCachedChatMessagesChronologically(existing, cached);

  expect(result).not.toBe(existing);
  expect(result).not.toBe(cached);
  expect(existing.map((message) => message.id)).toEqual(['existing']);
  expect(cached.map((message) => message.id)).toEqual(['cached']);
});

test('selectHistoryChatPlaceholderSource uses a meaningful five-row cache for notification first paint', () => {
  expect(
    selectHistoryChatPlaceholderSource({
      hasPrevious: true,
      cachedMessageCount: 5,
      openedFromNotification: true,
    }),
  ).toBe('cache');
});

test('selectHistoryChatPlaceholderSource preserves the previous snapshot when notification cache is only a preload stub', () => {
  expect(
    selectHistoryChatPlaceholderSource({
      hasPrevious: true,
      cachedMessageCount: 1,
      openedFromNotification: true,
    }),
  ).toBe('previous');
});

test('selectHistoryChatPlaceholderSource uses an ordinary two-row cache only when no previous snapshot exists', () => {
  expect(
    selectHistoryChatPlaceholderSource({
      hasPrevious: false,
      cachedMessageCount: 2,
      openedFromNotification: false,
    }),
  ).toBe('cache');
});

test('selectHistoryChatPlaceholderSource does not treat a lone ordinary cached row as usable history', () => {
  expect(
    selectHistoryChatPlaceholderSource({
      hasPrevious: false,
      cachedMessageCount: 1,
      openedFromNotification: false,
    }),
  ).toBe('none');
});

test('selectHistoryChatPlaceholderSource preserves a previous snapshot before considering ordinary cache', () => {
  expect(
    selectHistoryChatPlaceholderSource({
      hasPrevious: true,
      cachedMessageCount: 20,
      openedFromNotification: false,
    }),
  ).toBe('previous');
});
