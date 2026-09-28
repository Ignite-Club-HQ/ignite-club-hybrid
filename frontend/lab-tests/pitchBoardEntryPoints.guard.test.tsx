import { describe, expect, it } from 'vitest';

type Board = { id: string; clubId: string; isPublished: boolean };

function resolvePitchBoardEntry(boardId: string, boards: Board[], clubId: string) {
  const board = boards.find((entry) => entry.id === boardId && entry.clubId === clubId && entry.isPublished);
  if (!board) {
    return { ok: false, reason: 'board-not-available' } as const;
  }
  return { ok: true, board } as const;
}

describe('pitch board entry points guard', () => {
  it('requires a matching published board for the active club before allowing entry', () => {
    const boards: Board[] = [
      { id: 'board-1', clubId: 'club-1', isPublished: true },
      { id: 'board-2', clubId: 'club-2', isPublished: true },
      { id: 'board-3', clubId: 'club-1', isPublished: false },
    ];

    expect(resolvePitchBoardEntry('board-1', boards, 'club-1')).toMatchObject({ ok: true, board: { id: 'board-1' } });
    expect(resolvePitchBoardEntry('board-3', boards, 'club-1')).toEqual({ ok: false, reason: 'board-not-available' });
    expect(resolvePitchBoardEntry('board-2', boards, 'club-1')).toEqual({ ok: false, reason: 'board-not-available' });
  });
});
