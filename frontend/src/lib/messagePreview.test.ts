import { describe, expect, it } from 'vitest';
import { formatMessagePreview, getMessagePreviewText } from './messagePreview';

describe('news tokens in inbox previews', () => {
  const clubId = 'c1f2ed52-fda3-45b4-84d3-57fcf253116e';
  it.each([
    `[news:${clubId}]`,
    `[news:news-${clubId}-1]`,
    `[news:${clubId}:news-${clubId}-1]`,
  ])('consumes the complete legacy or scoped token %s', token => {
    const plain = formatMessagePreview(`[news:${clubId}]`);
    expect(getMessagePreviewText(token)).toBe(plain);
    expect(getMessagePreviewText(token)).not.toContain(clubId);
    expect(getMessagePreviewText(token)).not.toContain('[news:');
  });
  it('preserves surrounding text for multiple news shares', () => {
    const label = formatMessagePreview(`[news:${clubId}]`);
    expect(formatMessagePreview(`Today [news:${clubId}:news-${clubId}-1] and [news:old-post]`))
      .toBe(`Today ${label} and ${label}`);
  });
  it.each(['[news:bad id]', '[news:club:post:extra]', '[news:club:]', '[news:club:post'])
    ('leaves malformed tokens unchanged: %s', text => {
      expect(formatMessagePreview(text)).toBe(text);
    });
});

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