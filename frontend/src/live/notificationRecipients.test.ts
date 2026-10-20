import { describe, it, expect } from 'vitest';
import { notificationRecipients } from './notificationRecipients';

describe('canonical ICP notification delivery addresses', () => {
  it('collapses bare, roster-prefixed and whitespace versions of one principal', () => {
    expect(notificationRecipients(['aaaaa-aa', ' principal:aaaaa-aa ', '', ' '])).toEqual(['aaaaa-aa']);
  });
  it('refuses malformed and anonymous addresses before sending any batch', () => {
    expect(() => notificationRecipients(['aaaaa-aa', 'not-a-principal'])).toThrow();
    expect(() => notificationRecipients(['2vxsx-fae'])).toThrow('Invalid');
  });
});