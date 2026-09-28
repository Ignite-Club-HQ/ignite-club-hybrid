// Synthetic, in-memory adapter. This is not production authorization or an ICP canister.
export const DEMO_CLUB_ID = '00000000-0000-4000-8000-000000000001';
export function createFixtureClubLinksService({ role = 'club_admin', clubId = DEMO_CLUB_ID } = {}) {
  const rows = new Map();
  const requireMember = (id) => {
    if (id !== clubId || !['member', 'club_admin', 'app_admin'].includes(role)) throw new Error('Not authorized');
  };
  const requireAdmin = (id) => {
    requireMember(id);
    if (!['club_admin', 'app_admin'].includes(role)) throw new Error('Not authorized');
  };
  const get = (id) => { const row = rows.get(id); if (!row) throw new Error('Link not found'); return row; };
  const validate = (draft) => {
    if (!draft.title?.trim() || draft.title.length > 160) throw new Error('Title must be 1–160 characters');
    if (draft.url.length > 2048 || !['http:', 'https:'].includes(new URL(draft.url).protocol)) throw new Error('Invalid URL');
    if (!['embed', 'browser'].includes(draft.open_mode)) throw new Error('Invalid open mode');
  };
  const ordered = () => [...rows.values()].sort((a,b) => a.sort_order-b.sort_order || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return {
    async listAdmin(id) { requireAdmin(id); return structuredClone(ordered()); },
    async listVisible(id) { requireMember(id); return structuredClone(ordered().filter(r => r.is_active)); },
    async get(id) { const row=get(id); requireMember(row.club_id); if (!row.is_active && role==='member') throw new Error('Not authorized'); return structuredClone(row); },
    async save(id, draft) {
      requireAdmin(id); validate(draft);
      const existing=draft.id ? get(draft.id) : undefined;
      if (existing && existing.club_id !== id) throw new Error('Club cannot be changed');
      const row={id:existing?.id ?? crypto.randomUUID(), club_id:id, title:draft.title.trim(), subtitle:draft.subtitle?.trim() || null, url:draft.url, icon:draft.icon, open_mode:draft.open_mode, is_active:draft.is_active, sort_order:existing?.sort_order ?? (rows.size ? Math.max(...[...rows.values()].map(row => row.sort_order)) + 1 : 0), created_at:existing?.created_at ?? new Date().toISOString()};
      rows.set(row.id,row); return structuredClone(row);
    },
    async remove(id) { const row=get(id); requireAdmin(row.club_id); rows.delete(id); },
    async setActive(id, active) { const row=get(id); requireAdmin(row.club_id); row.is_active=!!active; },
    async reorder(id, first, second) {
      requireAdmin(id); const a=get(first), b=get(second);
      if (a.club_id!==id || b.club_id!==id) throw new Error('Not authorized');
      [a.sort_order,b.sort_order]=[b.sort_order,a.sort_order];
    },
  };
}

// This selection is deliberately explicit. There is no Supabase fallback.
export function selectClubLinksService(mode, icpService) {
  if (mode === 'fixture') return createFixtureClubLinksService();
  if (mode === 'icp' && icpService) return icpService;
  throw new Error('Local ICP service is not configured. No fallback is permitted.');
}
export const clubLinksService = selectClubLinksService('fixture');
