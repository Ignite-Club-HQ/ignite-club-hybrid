export interface ClubLink {
  id: string; club_id: string; title: string; subtitle: string | null;
  url: string; icon: string; open_mode: string; is_active: boolean;
  sort_order: number; created_at: string;
  revision?: bigint;
}
export type ClubLinkDraft = Pick<ClubLink, 'title' | 'subtitle' | 'url' | 'icon' | 'open_mode' | 'is_active'> & { id?: string; expectedRevision?: bigint };
/** Implement this with a local authenticated canister actor after its Candid contract is proven. */
export interface ClubLinksService {
  listAdmin(clubId: string): Promise<ClubLink[]>;
  listVisible(clubId: string): Promise<ClubLink[]>;
  get(id: string): Promise<ClubLink>;
  save(clubId: string, draft: ClubLinkDraft): Promise<ClubLink>;
  remove(id: string, expectedRevision?: bigint): Promise<void>;
  setActive(id: string, active: boolean, expectedRevision?: bigint): Promise<void>;
  reorder(clubId: string, firstId: string, secondId: string, expectedRevision?: bigint): Promise<void>;
}
