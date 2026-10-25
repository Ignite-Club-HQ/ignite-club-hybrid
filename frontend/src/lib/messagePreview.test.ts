import { describe, expect, it } from 'vitest';
import { formatMessagePreview, getMessagePreviewText } from './messagePreview';

describe('gallery tokens in inbox previews', () => {
  it.each([
    '5b872a95-29fe-4fc6-a006-a8cb46bd9821',
    'gallery-card-5b872a95-29fe-4fc6-a006-a8cb46bd9821-1',
  ])('consumes the complete gallery token for %s', id => {
    const preview = getMessagePreviewText(`[gallery:${id}]`);
    expect(preview).not.toContain(id);
    expect(preview).not.toContain('[gallery:');
    expect(preview.length).toBeGreaterThan(0);
  });
  it('retains accompanying text and removes multiple valid card tokens', () => {
    const preview = formatMessagePreview('Today [gallery:gallery-card-abc-1] and [gallery:gallery-card-def-2]');
    expect(preview.startsWith('Today ')).toBe(true);
    expect(preview).toContain(' and ');
    expect(preview).not.toContain('gallery-card-');
  });
  it('does not consume malformed brackets or ordinary text', () => {
    const text = 'gallery-card-abc-1 [gallery:bad id]';
    expect(formatMessagePreview(text)).toBe(text);
  });
});