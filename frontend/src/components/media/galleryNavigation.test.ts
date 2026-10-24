import { describe, expect, it } from 'vitest';
import { galleryCanModerate, galleryLinkState } from './galleryNavigation';
describe('authorized gallery presentation', () => {
  it('preserves exact photo/comment and event/team deep links', () => {
    expect(galleryLinkState(new URLSearchParams('photo=asset-2&comments=1&event=evt-1&team=team-2')))
      .toEqual({ photoId: 'asset-2', comments: true, clubId: null, teamId: 'team-2', eventId: 'evt-1', cardId: null });
  });
  it('limits team moderation to the owning team', () => {
    const grants = [{ club: ['club-a'], team: ['team-a'], role: 'team_admin' }];
    expect(galleryCanModerate(grants, 'club-a', 'team-a')).toBe(true);
    expect(galleryCanModerate(grants, 'club-a', 'team-b')).toBe(false);
    expect(galleryCanModerate(grants, 'club-b', 'team-a')).toBe(false);
  });
});