import type { ClubLink, ClubLinkDraft, ClubLinksService } from "@/lab/ClubLinksService";
import { withFeatureBackend } from "../featureRouter";
import { supabase } from "@/integrations/supabase/client";

/**
 * Club Info & Links: club_domain list_links/mutate in ICP mode, club_links
 * table in Supabase mode. ICP writes use optimistic listing revisions.
 */
const toLink = (l: any, revision: bigint): ClubLink => ({
  id: l.id,
  club_id: l.club_id,
  title: l.draft.title,
  subtitle: l.draft.subtitle?.[0] ?? null,
  url: l.draft.url,
  icon: l.draft.icon,
  open_mode: l.draft.open_mode,
  is_active: l.draft.is_active,
  sort_order: Number(l.sort_order),
  created_at: new Date(Number(l.created_at_ms ?? 0)).toISOString(),
  revision,
});

async function icpActor(ctx: any) {
  const { connectLiveClubDomain } = await import("../domains");
  return (await connectLiveClubDomain(ctx.target, ctx.identity)).actor as any;
}

async function icpListing(ctx: any, clubId: string, admin: boolean) {
  const actor = await icpActor(ctx);
  const res = await actor.list_links(clubId, admin);
  if ("Err" in res) throw new Error(res.Err === "Forbidden" ? "Not authorized" : res.Err);
  const rev: bigint = res.Ok.revision;
  return { actor, rev, links: (res.Ok.links as any[]).map((l) => toLink(l, rev)).sort((a, b) => a.sort_order - b.sort_order) };
}

async function icpMutate(ctx: any, clubId: string, operation: any) {
  const { actor, rev } = await icpListing(ctx, clubId, true);
  const res = await actor.mutate({ club: clubId, expected_revision: rev, operation, request_id: crypto.randomUUID() });
  if ("Err" in res) throw new Error(res.Err);
  return res.Ok;
}

async function clubOfLink(ctx: any, linkId: string): Promise<string> {
  const actor = await icpActor(ctx);
  const res = await actor.get_club_link(linkId);
  if ("Err" in res || !res.Ok.length) throw new Error("Link not found");
  return res.Ok[0].club_id;
}

const draftOf = (d: ClubLinkDraft) => ({
  title: d.title, subtitle: d.subtitle ? [d.subtitle] : [], url: d.url,
  icon: d.icon, open_mode: d.open_mode, is_active: d.is_active,
});

export const liveClubLinksService: ClubLinksService = {
  listAdmin: (clubId) => withFeatureBackend("membership", {
    supabase: async () => {
      const { data, error } = await supabase.from("club_links").select("*").eq("club_id", clubId).order("sort_order");
      if (error) throw error;
      return (data ?? []) as any;
    },
    icp: async (ctx) => (await icpListing(ctx, clubId, true)).links,
  }),
  listVisible: (clubId) => withFeatureBackend("membership", {
    supabase: async () => {
      const { data, error } = await supabase.from("club_links").select("*").eq("club_id", clubId).eq("is_active", true).order("sort_order");
      if (error) throw error;
      return (data ?? []) as any;
    },
    icp: async (ctx) => (await icpListing(ctx, clubId, false)).links,
  }),
  get: (id) => withFeatureBackend("membership", {
    supabase: async () => {
      const { data, error } = await supabase.from("club_links").select("*").eq("id", id).single();
      if (error) throw error;
      return data as any;
    },
    icp: async (ctx) => {
      const actor = await icpActor(ctx);
      const res = await actor.get_club_link(id);
      if ("Err" in res || !res.Ok.length) throw new Error("Link not found");
      return toLink(res.Ok[0], 0n);
    },
  }),
  save: (clubId, draft) => withFeatureBackend("membership", {
    supabase: async () => {
      const row = { club_id: clubId, title: draft.title, subtitle: draft.subtitle, url: draft.url, icon: draft.icon, open_mode: draft.open_mode, is_active: draft.is_active };
      const q = draft.id
        ? supabase.from("club_links").update(row).eq("id", draft.id).select().single()
        : supabase.from("club_links").insert(row).select().single();
      const { data, error } = await q;
      if (error) throw error;
      return data as any;
    },
    icp: async (ctx) => {
      const m = await icpMutate(ctx, clubId, { Save: { id: draft.id ? [draft.id] : [], draft: draftOf(draft) } });
      return toLink(m.link[0], m.revision);
    },
  }),
  remove: (id) => withFeatureBackend("membership", {
    supabase: async () => {
      const { error } = await supabase.from("club_links").delete().eq("id", id);
      if (error) throw error;
    },
    icp: async (ctx) => { await icpMutate(ctx, await clubOfLink(ctx, id), { Remove: { id } }); },
  }),
  setActive: (id, active) => withFeatureBackend("membership", {
    supabase: async () => {
      const { error } = await supabase.from("club_links").update({ is_active: active }).eq("id", id);
      if (error) throw error;
    },
    icp: async (ctx) => { await icpMutate(ctx, await clubOfLink(ctx, id), { SetActive: { id, active } }); },
  }),
  reorder: (clubId, first, second) => withFeatureBackend("membership", {
    supabase: async () => {
      const { data, error } = await supabase.from("club_links").select("id, sort_order").in("id", [first, second]);
      if (error) throw error;
      const a = data?.find((r) => r.id === first), b = data?.find((r) => r.id === second);
      if (!a || !b) throw new Error("Link not found");
      await supabase.from("club_links").update({ sort_order: b.sort_order }).eq("id", a.id);
      await supabase.from("club_links").update({ sort_order: a.sort_order }).eq("id", b.id);
    },
    icp: async (ctx) => { await icpMutate(ctx, clubId, { Reorder: { first, second } }); },
  }),
};
