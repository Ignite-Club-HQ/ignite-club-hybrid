import { describe, expect, it } from 'vitest';
import { writeOnce } from './clubScope';

describe('single-attempt mutation scopes', () => {
  it('keeps consecutive comments distinct instead of coalescing them as one write', () => {
    const first = writeOnce({ photoId: 'photo' });
    const second = writeOnce({ photoId: 'photo' });
    expect(first.writeKey).not.toBe(second.writeKey);
    expect(first.attempts).toBe(1);
    expect(second.attempts).toBe(1);
    expect(second.photoId).toBe('photo');
  });
});