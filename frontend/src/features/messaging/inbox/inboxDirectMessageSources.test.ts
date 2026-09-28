import { describe, expect, it, vi } from "vitest";
import {
  hydrateCachedDirectMessages,
  buildPreviousDirectMessagePeerMap,
  loadDirectMessagePeerProfiles,
  assembleDirectMessageInboxConversations,
  buildDirectMessageCachePayload,
  resolveDirectMessagePeerProfile,
  resolveEffectiveDirectMessages,
} from "./inboxDirectMessageSources";

describe("buildDirectMessageCachePayload", () => {
  const peer = { id: "peer-1", display_name: "Peer One", avatar_url: "peer.jpg" };
  const base = {
    id: "dm-1",
    participant_1: "me",
    participant_2: "peer-1",
    updated_at: "2026-08-06T11:00:00Z",
    created_at: "2026-08-01T10:00:00Z",
    created_by: "me",
    other_user: peer,
  };

  it("keeps only the established persistent conversation metadata", () => {
    const payload = buildDirectMessageCachePayload({
      conversations: [{ ...base, transient: "not persisted", last_message: null }],
      currentUserId: "me",
    });
    expect(payload.dmConversations).toEqual([{
      id: "dm-1",
      participant_1: "me",
      participant_2: "peer-1",
      updated_at: "2026-08-06T11:00:00Z",
      created_at: "2026-08-01T10:00:00Z",
      created_by: "me",
      other_user: peer,
    }]);
    expect(payload.dmConversations[0]).not.toHaveProperty("transient");
  });

  it("normalizes missing creation ownership to null", () => {
    const payload = buildDirectMessageCachePayload({
      conversations: [{ ...base, created_by: undefined, last_message: null }],
      currentUserId: "me",
    });
    expect(payload.dmConversations[0].created_by).toBeNull();
  });

  it("labels a current-user preview as You and preserves its media", () => {
    const payload = buildDirectMessageCachePayload({
      conversations: [{
        ...base,
        last_message: { text: "Sent", image_url: "photo.jpg", created_at: "now", author_id: "me" },
      }],
      currentUserId: "me",
    });
    expect(payload.latestDMMessages).toEqual({
      "dm-1": { text: "Sent", author: "You", created_at: "now", image_url: "photo.jpg" },
    });
  });

  it("labels a received preview with the resolved peer name or an empty fallback", () => {
    const message = { text: "Received", image_url: null, created_at: "now", author_id: "peer-1" };
    const payload = buildDirectMessageCachePayload({
      conversations: [
        { ...base, last_message: message },
        { ...base, id: "dm-2", other_user: { ...peer, display_name: null }, last_message: message },
      ],
      currentUserId: "me",
    });
    expect(payload.latestDMMessages["dm-1"].author).toBe("Peer One");
    expect(payload.latestDMMessages["dm-2"].author).toBe("");
  });

  it("omits preview entries for conversations without a latest message", () => {
    const payload = buildDirectMessageCachePayload({
      conversations: [{ ...base, last_message: null }],
      currentUserId: "me",
    });
    expect(payload.latestDMMessages).toEqual({});
  });
});

describe("assembleDirectMessageInboxConversations", () => {
  const peerOne = { id: "peer-1", display_name: "Peer One", avatar_url: null };
  const peerTwo = { id: "peer-2", display_name: "Peer Two", avatar_url: "two.jpg" };
  const conversations = [
    { id: "dm-1", participant_1: "me", participant_2: "peer-1", updated_at: "newer", marker: "kept-1" },
    { id: "dm-2", participant_1: "peer-2", participant_2: "me", updated_at: "older", marker: "kept-2" },
  ];

  it("derives the peer from either participant position and preserves source row fields", () => {
    const result = assembleDirectMessageInboxConversations({
      conversations,
      currentUserId: "me",
      fetchedProfiles: new Map([["peer-1", peerOne], ["peer-2", peerTwo]]),
      previousProfiles: new Map(),
      latestMessages: new Map(),
      getGlobalProfile: () => null,
    });
    expect(result.map(({ id, marker, other_user }) => ({ id, marker, other_user }))).toEqual([
      { id: "dm-1", marker: "kept-1", other_user: peerOne },
      { id: "dm-2", marker: "kept-2", other_user: peerTwo },
    ]);
  });

  it("joins each latest message only through its immutable conversation id", () => {
    const messageTwo = { text: "Second", image_url: null, created_at: "now", author_id: "peer-2" };
    const result = assembleDirectMessageInboxConversations({
      conversations,
      currentUserId: "me",
      fetchedProfiles: new Map(),
      previousProfiles: new Map(),
      latestMessages: new Map([["dm-2", messageTwo], ["different-dm", { ...messageTwo, text: "Wrong" }]]),
      getGlobalProfile: () => null,
    });
    expect(result[0].last_message).toBeNull();
    expect(result[1].last_message).toBe(messageTwo);
  });

  it("passes previous and global identities through the established profile precedence", () => {
    const previous = { id: "peer-1", display_name: "Previous One", avatar_url: null };
    const global = { id: "peer-2", display_name: "Global Two", avatar_url: "global.jpg" };
    const getGlobalProfile = vi.fn((id: string) => id === "peer-2" ? global : null);
    const result = assembleDirectMessageInboxConversations({
      conversations,
      currentUserId: "me",
      fetchedProfiles: new Map(),
      previousProfiles: new Map([["peer-1", previous]]),
      latestMessages: new Map(),
      getGlobalProfile,
    });
    expect(result[0].other_user).toBe(previous);
    expect(result[1].other_user).toEqual(global);
    expect(getGlobalProfile).toHaveBeenCalledWith("peer-1");
    expect(getGlobalProfile).toHaveBeenCalledWith("peer-2");
  });

  it("keeps an identity-only fetched peer when no named fallback exists", () => {
    const result = assembleDirectMessageInboxConversations({
      conversations: [conversations[0]],
      currentUserId: "me",
      fetchedProfiles: new Map([["peer-1", { id: "peer-1", display_name: null, avatar_url: "avatar.jpg" }]]),
      previousProfiles: new Map(),
      latestMessages: new Map(),
      getGlobalProfile: () => null,
    });
    expect(result[0].other_user).toEqual({ id: "peer-1", display_name: null, avatar_url: "avatar.jpg" });
  });

  it("returns an empty assembled list without consulting global profiles", () => {
    const getGlobalProfile = vi.fn();
    expect(assembleDirectMessageInboxConversations({
      conversations: [],
      currentUserId: "me",
      fetchedProfiles: new Map(),
      previousProfiles: new Map(),
      latestMessages: new Map(),
      getGlobalProfile,
    })).toEqual([]);
    expect(getGlobalProfile).not.toHaveBeenCalled();
  });
});

describe("loadDirectMessagePeerProfiles", () => {
  it("publishes fresh profiles to the global cache and timestamps one returned map", async () => {
    const profiles = [
      { id: "peer-1", display_name: "Peer One", avatar_url: null },
      { id: "peer-2", display_name: "Peer Two", avatar_url: "two.jpg" },
    ];
    const selectProfiles = vi.fn(async () => ({ data: profiles, error: null }));
    const refreshCache = vi.fn();
    const fetchStale = vi.fn();

    const result = await loadDirectMessagePeerProfiles(["peer-1", "peer-2"], {
      selectProfiles: selectProfiles as unknown as typeof import("@/lib/profileCache").selectCachedProfilesByIds,
      refreshCache,
      fetchStale,
      now: () => 1234,
    });

    expect(refreshCache).toHaveBeenCalledOnce();
    expect(refreshCache).toHaveBeenCalledWith(profiles);
    expect([...result.entries()]).toEqual([
      ["peer-1", { ...profiles[0], cached_at: 1234 }],
      ["peer-2", { ...profiles[1], cached_at: 1234 }],
    ]);
    expect(fetchStale).not.toHaveBeenCalled();
  });

  it("treats a successful empty fresh response as authoritative without refreshing cache", async () => {
    const selectProfiles = vi.fn(async () => ({ data: [], error: null }));
    const refreshCache = vi.fn();
    const fetchStale = vi.fn();

    const result = await loadDirectMessagePeerProfiles(["peer-1"], {
      selectProfiles: selectProfiles as unknown as typeof import("@/lib/profileCache").selectCachedProfilesByIds,
      refreshCache,
      fetchStale,
      now: () => 1234,
    });
    expect(result.size).toBe(0);
    expect(refreshCache).not.toHaveBeenCalled();
    expect(fetchStale).not.toHaveBeenCalled();
  });

  it("falls back to stale cache with the established timeout after a fresh-read failure", async () => {
    const selectProfiles = vi.fn(async () => { throw new Error("profiles unavailable"); });
    const stale = new Map([["peer-1", { id: "peer-1", display_name: "Cached Peer", avatar_url: null }]]);
    const fetchStale = vi.fn(async () => stale);

    await expect(loadDirectMessagePeerProfiles(["peer-1"], {
      selectProfiles: selectProfiles as unknown as typeof import("@/lib/profileCache").selectCachedProfilesByIds,
      refreshCache: vi.fn(),
      fetchStale,
    })).resolves.toBe(stale);
    expect(fetchStale).toHaveBeenCalledWith(["peer-1"], { allowStale: true, timeout: 15_000 });
  });

  it("uses stale cache if refreshing the global cache fails after a fresh read", async () => {
    const selectProfiles = vi.fn(async () => ({
      data: [{ id: "peer-1", display_name: "Fresh Peer", avatar_url: null }],
      error: null,
    }));
    const stale = new Map([["peer-1", { id: "peer-1", display_name: "Cached Peer", avatar_url: null }]]);
    const fetchStale = vi.fn(async () => stale);

    await expect(loadDirectMessagePeerProfiles(["peer-1"], {
      selectProfiles: selectProfiles as unknown as typeof import("@/lib/profileCache").selectCachedProfilesByIds,
      refreshCache: () => { throw new Error("cache refresh failed"); },
      fetchStale,
    })).resolves.toBe(stale);
  });

  it("propagates a stale-cache failure after the fresh path has failed", async () => {
    const failure = new Error("all profile sources unavailable");
    await expect(loadDirectMessagePeerProfiles(["peer-1"], {
      selectProfiles: (async () => { throw new Error("fresh unavailable"); }) as typeof import("@/lib/profileCache").selectCachedProfilesByIds,
      refreshCache: vi.fn(),
      fetchStale: async () => { throw failure; },
    })).rejects.toBe(failure);
  });
});

describe("buildPreviousDirectMessagePeerMap", () => {
  const livePeer = { id: "peer-1", display_name: "Current Name", avatar_url: "current.jpg" };
  const cachedPeer = { id: "peer-1", display_name: "Old Name", avatar_url: "old.jpg" };

  it("uses the current React Query identity ahead of an older persistent identity", () => {
    const result = buildPreviousDirectMessagePeerMap({
      live: [{ other_user: livePeer }],
      cached: [{ other_user: cachedPeer }],
    });
    expect(result.get("peer-1")).toBe(livePeer);
  });

  it("fills identities missing from the live result using persistent cache", () => {
    const cachedOnly = { id: "peer-2", display_name: "Cached Peer", avatar_url: null };
    const result = buildPreviousDirectMessagePeerMap({
      live: [{ other_user: livePeer }],
      cached: [{ other_user: cachedOnly }],
    });
    expect([...result.entries()]).toEqual([
      ["peer-1", livePeer],
      ["peer-2", cachedOnly],
    ]);
  });

  it("ignores live identities without an id or usable display name", () => {
    const result = buildPreviousDirectMessagePeerMap({
      live: [
        { other_user: { id: "", display_name: "No ID", avatar_url: null } },
        { other_user: { id: "peer-1", display_name: null, avatar_url: "avatar.jpg" } },
        { other_user: null },
      ],
    });
    expect(result.size).toBe(0);
  });

  it("allows a valid cached identity to replace an unusable live identity", () => {
    const result = buildPreviousDirectMessagePeerMap({
      live: [{ other_user: { id: "peer-1", display_name: null, avatar_url: "new.jpg" } }],
      cached: [{ other_user: cachedPeer }],
    });
    expect(result.get("peer-1")).toBe(cachedPeer);
  });

  it("returns an empty map when neither source contains conversations", () => {
    expect(buildPreviousDirectMessagePeerMap({ live: null, cached: undefined }).size).toBe(0);
  });
});

describe("resolveDirectMessagePeerProfile", () => {
  const fetched = { id: "peer", display_name: "Fresh Name", avatar_url: "fresh.jpg" };
  const previous = { id: "peer", display_name: "Previous Name", avatar_url: "previous.jpg", retained: true };
  const globalCached = { id: "peer", display_name: "Global Name", avatar_url: "global.jpg" };

  it("prefers a freshly fetched named profile and its avatar", () => {
    expect(resolveDirectMessagePeerProfile({ otherUserId: "peer", fetched, previous, globalCached })).toEqual({
      id: "peer", display_name: "Fresh Name", avatar_url: "fresh.jpg",
    });
  });

  it("fills a missing fresh avatar from the previous inbox identity before global cache", () => {
    expect(resolveDirectMessagePeerProfile({
      otherUserId: "peer",
      fetched: { ...fetched, avatar_url: null },
      previous,
      globalCached,
    })).toEqual({ id: "peer", display_name: "Fresh Name", avatar_url: "previous.jpg" });
  });

  it("fills a missing fresh avatar from global cache when no previous avatar exists", () => {
    expect(resolveDirectMessagePeerProfile({
      otherUserId: "peer",
      fetched: { ...fetched, avatar_url: null },
      previous: { ...previous, avatar_url: null },
      globalCached,
    })).toEqual({ id: "peer", display_name: "Fresh Name", avatar_url: "global.jpg" });
  });

  it("retains the previous named inbox identity when the fresh result has no name", () => {
    expect(resolveDirectMessagePeerProfile({
      otherUserId: "peer",
      fetched: { id: "peer", display_name: null, avatar_url: "fresh.jpg" },
      previous,
      globalCached,
    })).toBe(previous);
  });

  it("uses global cache when neither fresh nor previous data has a usable name", () => {
    expect(resolveDirectMessagePeerProfile({
      otherUserId: "peer",
      fetched: { id: "peer", display_name: null, avatar_url: "fresh.jpg" },
      previous: null,
      globalCached,
    })).toEqual({ id: "peer", display_name: "Global Name", avatar_url: "global.jpg" });
  });

  it("keeps a fresh identity-only result when no named fallback exists", () => {
    expect(resolveDirectMessagePeerProfile({
      otherUserId: "peer",
      fetched: { id: "unexpected-id", display_name: null, avatar_url: "fresh.jpg" },
    })).toEqual({ id: "peer", display_name: null, avatar_url: "fresh.jpg" });
  });

  it("returns null only when every profile source is absent", () => {
    expect(resolveDirectMessagePeerProfile({ otherUserId: "peer" })).toBeNull();
  });
});

describe("hydrateCachedDirectMessages", () => {
  it("returns an empty list without cached conversations", () => {
    expect(hydrateCachedDirectMessages({ conversations: null })).toEqual([]);
  });

  it("preserves row fields and normalizes missing creation metadata", () => {
    const [result] = hydrateCachedDirectMessages({
      conversations: [{ id: "dm-1", updated_at: "2026-08-01", label: "kept" }],
    });
    expect(result).toMatchObject({
      id: "dm-1", label: "kept", created_at: "2026-08-01", created_by: null,
      last_message: null,
    });
  });

  it("does not replace existing creation metadata", () => {
    const [result] = hydrateCachedDirectMessages({
      conversations: [{ id: "dm-1", created_at: "created", updated_at: "updated", created_by: "owner" }],
    });
    expect(result.created_at).toBe("created");
    expect(result.created_by).toBe("owner");
  });

  it("hydrates a sent-by-me preview with the current user author id", () => {
    const [result] = hydrateCachedDirectMessages({
      conversations: [{ id: "dm-1", other_user: { id: "peer" } }],
      latestMessages: { "dm-1": { text: "Hello", created_at: "now", author: "You" } },
      currentUserId: "me",
    });
    expect(result.last_message).toEqual({
      text: "Hello", image_url: null, created_at: "now", author_id: "me",
    });
  });

  it("hydrates a received preview with the peer author id", () => {
    const [result] = hydrateCachedDirectMessages({
      conversations: [{ id: "dm-1", other_user: { id: "peer" } }],
      latestMessages: { "dm-1": { text: null, image_url: "photo.jpg", created_at: "now", author: "Peer" } },
      currentUserId: "me",
    });
    expect(result.last_message).toEqual({
      text: null, image_url: "photo.jpg", created_at: "now", author_id: "peer",
    });
  });
});

describe("resolveEffectiveDirectMessages", () => {
  const sticky = [{ id: "live" }];
  const cached = [{ id: "cached" }];

  it("preserves a non-empty sticky list online and offline", () => {
    expect(resolveEffectiveDirectMessages({ sticky, offlineCached: cached, isOnline: true })).toBe(sticky);
    expect(resolveEffectiveDirectMessages({ sticky, offlineCached: cached, isOnline: false })).toBe(sticky);
  });

  it("uses cached rows only while offline and sticky is empty", () => {
    expect(resolveEffectiveDirectMessages({ sticky: [], offlineCached: cached, isOnline: false })).toBe(cached);
    expect(resolveEffectiveDirectMessages({ sticky: [], offlineCached: cached, isOnline: true })).toEqual([]);
  });

  it("returns an empty list when neither source has rows", () => {
    expect(resolveEffectiveDirectMessages({ sticky: null, offlineCached: null, isOnline: false })).toEqual([]);
  });
});
