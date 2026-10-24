export function galleryLinkState(params: URLSearchParams) {
  return { photoId: params.get('photo'), comments: params.get('comments') === '1',
    clubId: params.get('club'), teamId: params.get('team'), eventId: params.get('event'), cardId: params.get('card') };
}
export function galleryCanModerate(grants: Array<{ club: string[]; team: string[]; role: string }>, clubId: string, teamId: string | null) {
  return grants.some(g => g.role === 'app_admin' || g.club[0] === clubId &&
    (['club_admin', 'committee'].includes(g.role) || !!teamId && g.team[0] === teamId && ['team_admin', 'coach'].includes(g.role)));
}