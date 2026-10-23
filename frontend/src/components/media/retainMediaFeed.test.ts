import { describe, expect, it } from 'vitest';
import { retainMediaFeed } from './retainMediaFeed';
const photo = (id: string, clubId = 'a', createdAtMs = 10) => ({ id, clubId, createdAtMs });
describe('gallery refresh retention', () => {
  it('keeps visible photos while another source publishes an empty loading update', () => {
    expect(retainMediaFeed({ posts: [photo('visible')] }, { posts: [], sources: [{ clubId: 'a', state: 'loading' }] }).posts).toEqual([photo('visible')]);
  });
  it('retains older scrolled pages but removes absent photos in the refreshed range', () => {
    const result = retainMediaFeed({ posts: [photo('deleted', 'a', 30), photo('older', 'a', 1)] }, { posts: [photo('fresh', 'a', 20)], sources: [{ clubId: 'a', state: 'ready' }], hasMore: true });
    expect(result.posts.map(p => p.id)).toEqual(['fresh', 'older']);
  });
  it('does not retain denied or no-longer-member club photos', () => {
    expect(retainMediaFeed({ posts: [photo('denied'), photo('removed', 'b')] }, { posts: [photo('denied')], sources: [{ clubId: 'a', state: 'denied' }] }).posts).toEqual([]);
  });
  it('accepts an authoritative exhausted empty feed', () => {
    expect(retainMediaFeed({ posts: [photo('deleted')] }, { posts: [], sources: [{ clubId: 'a', state: 'ready' }], hasMore: false }).posts).toEqual([]);
  });
});