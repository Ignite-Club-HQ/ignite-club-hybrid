import { expect, test } from 'vitest';
import {
  buildAuthPathWithIntent,
  readAuthIntent,
  readRedirectParam,
} from '../src/lib/authRedirectStorage';

test('preserves invite signup intent in the URL', () => {
  const path = buildAuthPathWithIntent({
    next: '/join/p/abc123',
    mode: 'signup',
    invite: 'abc123',
  });

  expect(readAuthIntent(path.slice(path.indexOf('?')))).toEqual({
    mode: 'signup',
    next: '/join/p/abc123',
    invite: 'abc123',
  });
});

test('keeps the legacy redirect parameter readable', () => {
  const path = buildAuthPathWithIntent({ next: '/join/p/abc', mode: 'signup' });
  expect(readRedirectParam(path.slice(path.indexOf('?')))).toBe('/join/p/abc');
});

test('rejects off-origin destinations before either backend can be selected', () => {
  const path = buildAuthPathWithIntent({
    next: 'https://reference.invalid',
    mode: 'signup',
  });

  expect(readAuthIntent(path.slice(path.indexOf('?'))).next).toBeNull();
  expect(buildAuthPathWithIntent({ next: '//evil.example' })).toBe('/auth');
});

test('ignores unknown auth modes', () => {
  expect(readAuthIntent('?mode=bogus&next=%2Fjoin%2Fp%2Fx').mode).toBeNull();
});
