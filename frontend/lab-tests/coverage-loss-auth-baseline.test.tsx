import { onlineManager } from '@tanstack/react-query';
import { afterEach, expect, test } from 'vitest';
import { isTransientAuthFailure } from '../src/lib/authRecoveryClassification';

afterEach(() => {
  onlineManager.setOnline(true);
});

test('adapts the imported coverage-loss baseline for transient auth failures', () => {
  expect(isTransientAuthFailure({ name: 'AuthRetryableFetchError', status: 0 })).toBe(true);
  expect(isTransientAuthFailure(new TypeError('Failed to fetch'))).toBe(true);
  expect(isTransientAuthFailure({ message: 'Network request failed' })).toBe(true);
  expect(isTransientAuthFailure({ code: 'refresh_token_not_found', status: 400 })).toBe(false);
});

test('treats all auth failures as transient while offline', () => {
  onlineManager.setOnline(false);
  expect(isTransientAuthFailure({ code: 'refresh_token_not_found', status: 400 })).toBe(true);
});

test('keeps provider-neutral auth classification strict while online', () => {
  expect(isTransientAuthFailure({ code: 'network_error' })).toBe(true);
  expect(isTransientAuthFailure({ status: 503 })).toBe(true);
  expect(isTransientAuthFailure({ message: 'invalid refresh token' })).toBe(false);
});
