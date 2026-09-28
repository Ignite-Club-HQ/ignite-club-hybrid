import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  buildVaultUploadPath,
  createVaultExternalLink,
  getVaultUploadScope,
  uploadVaultItem,
  type VaultUploadDependencies,
} from "./vaultUploadService";

type IgniteSupabaseClient = SupabaseClient<Database>;

describe("Vault upload scope and storage paths", () => {
  it("builds exact club, team, and mini-league scope fields", () => {
    expect(getVaultUploadScope({ type: "club", clubId: "club-a", clubName: "Club A" }))
      .toEqual({ club_id: "club-a" });
    expect(getVaultUploadScope({
      type: "team", clubId: "club-a", clubName: "Club A", teamId: "team-a", teamName: "Team A",
    })).toEqual({ club_id: "club-a", team_id: "team-a" });
    expect(getVaultUploadScope({
      type: "mini-league", clubId: "club-a", clubName: "Club A",
      miniLeagueId: "league-a", miniLeagueName: "League A",
    })).toEqual({ club_id: "club-a", mini_league_id: "league-a" });
    expect(getVaultUploadScope({ type: "root" })).toEqual({});
  });

  it("builds the characterized team storage path", () => {
    expect(buildVaultUploadPath({
      view: {
        type: "team", clubId: "club-a", clubName: "Club A", teamId: "team-a", teamName: "Team A",
      },
      userId: "user-a",
      fileName: "report.pdf",
      timestamp: 123,
      randomValue: 0.123456789,
    })).toBe("clubs/club-a/teams/team-a/user-a/123-xjylrx.pdf");
  });

  it("builds club, mini-league, and unassigned paths without cross-scope IDs", () => {
    const stable = { userId: "user-a", fileName: "photo.jpg", timestamp: 123, randomValue: 0.5 };
    expect(buildVaultUploadPath({
      ...stable, view: { type: "club", clubId: "club-a", clubName: "Club A" },
    })).toBe("clubs/club-a/user-a/123-.jpg");
    expect(buildVaultUploadPath({
      ...stable,
      view: {
        type: "mini-league", clubId: "club-a", clubName: "Club A",
        miniLeagueId: "league-a", miniLeagueName: "League A",
      },
    })).toBe("clubs/club-a/mini-leagues/league-a/user-a/123-.jpg");
    expect(buildVaultUploadPath({ ...stable, view: { type: "root" } }))
      .toBe("unassigned/user-a/123-.jpg");
  });
});

function insertClient(error: unknown = null) {
  const inserts: unknown[] = [];
  const query = {
    insert: (payload: unknown) => {
      inserts.push(payload);
      return Promise.resolve({ data: null, error });
    },
  };
  return { client: { from: () => query } as unknown as IgniteSupabaseClient, inserts };
}

describe("Vault external-link creation", () => {
  it("creates a zero-byte team-scoped external link with exact ownership and folder", async () => {
    const fake = insertClient();
    await createVaultExternalLink({
      url: "https://example.com/document",
      name: "Shared document",
      userId: "user-a",
      folderId: "folder-a",
      view: {
        type: "team", clubId: "club-a", clubName: "Club A", teamId: "team-a", teamName: "Team A",
      },
    }, fake.client);
    expect(fake.inserts).toEqual([{
      file_url: "https://example.com/document",
      uploaded_by: "user-a",
      name: "Shared document",
      folder_id: "folder-a",
      is_external_link: true,
      file_size: 0,
      club_id: "club-a",
      team_id: "team-a",
    }]);
  });

  it("applies mini-league scope without inventing a team ID", async () => {
    const fake = insertClient();
    await createVaultExternalLink({
      url: "https://example.com/fixture",
      name: "Fixture",
      userId: "user-a",
      folderId: null,
      view: {
        type: "mini-league", clubId: "club-a", clubName: "Club A",
        miniLeagueId: "league-a", miniLeagueName: "League A",
      },
    }, fake.client);
    expect(fake.inserts[0]).toMatchObject({ club_id: "club-a", mini_league_id: "league-a" });
    expect(fake.inserts[0]).not.toHaveProperty("team_id");
  });

  it("propagates insertion failures", async () => {
    const denied = { message: "permission denied", code: "42501" };
    const fake = insertClient(denied);
    await expect(createVaultExternalLink({
      url: "https://example.com",
      name: "Denied",
      userId: "user-a",
      folderId: null,
      view: { type: "root" },
    }, fake.client)).rejects.toBe(denied);
  });
});

function uploadTransaction(options: { uploadError?: unknown; insertError?: unknown } = {}) {
  const events: string[] = [];
  const inserts: unknown[] = [];
  const upload = vi.fn(async () => {
    events.push("upload");
    return { data: null, error: options.uploadError ?? null };
  });
  const client = {
    storage: { from: () => ({ upload }) },
    from: () => ({
      insert: async (payload: unknown) => {
        events.push("insert");
        inserts.push(payload);
        return { data: null, error: options.insertError ?? null };
      },
    }),
  } as unknown as IgniteSupabaseClient;
  const dependencies: VaultUploadDependencies = {
    reserveStorage: vi.fn(async () => {
      events.push("reserve");
      return "reservation-a";
    }),
    settleStorage: vi.fn(async (_id, committed) => {
      events.push(`settle:${committed}`);
    }),
    compensateUpload: vi.fn(async () => {
      events.push("compensate");
    }),
    buildStorageUrl: vi.fn((path) => `local://${path}`),
  };
  return { client, dependencies, events, inserts, upload };
}

describe("Vault upload transaction", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reserves before bytes, writes metadata after upload, then commits the reservation", async () => {
    vi.spyOn(Date, "now").mockReturnValue(123);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);
    const fake = uploadTransaction();
    const file = new File(["photo"], "match photo.jpg", { type: "image/jpeg" });

    await uploadVaultItem({
      kind: "photo",
      file,
      name: file.name,
      userId: "user-a",
      folderId: "folder-a",
      view: {
        type: "team", clubId: "club-a", clubName: "Club A", teamId: "team-a", teamName: "Team A",
      },
    }, fake.client, fake.dependencies);

    const path = "clubs/club-a/teams/team-a/user-a/123-xjylrx.jpg";
    expect(fake.events).toEqual(["reserve", "upload", "insert", "settle:true"]);
    expect(fake.dependencies.reserveStorage).toHaveBeenCalledWith("club-a", file.size);
    expect(fake.upload).toHaveBeenCalledWith(path, file, { cacheControl: "31536000" });
    expect(fake.inserts).toEqual([{
      file_url: `local://${path}`,
      storage_bucket: "photos",
      storage_path: path,
      uploaded_by: "user-a",
      name: "match photo.jpg",
      folder_id: "folder-a",
      file_size: file.size,
      club_id: "club-a",
      team_id: "team-a",
      file_type: "image/jpeg",
    }]);
  });

  it("preserves a custom document name and omits photo-only MIME metadata", async () => {
    const fake = uploadTransaction();
    const file = new File(["report"], "raw.pdf", { type: "application/pdf" });
    await uploadVaultItem({
      kind: "file",
      file,
      name: "Committee report",
      userId: "user-a",
      folderId: null,
      view: { type: "club", clubId: "club-a", clubName: "Club A" },
    }, fake.client, fake.dependencies);
    expect(fake.inserts[0]).toMatchObject({ name: "Committee report", club_id: "club-a" });
    expect(fake.inserts[0]).not.toHaveProperty("file_type");
  });

  it("does not write bytes when quota reservation fails", async () => {
    const fake = uploadTransaction();
    const denied = new Error("Storage limit reached");
    fake.dependencies.reserveStorage = vi.fn(async () => {
      fake.events.push("reserve");
      throw denied;
    });
    await expect(uploadVaultItem({
      kind: "file",
      file: new File(["x"], "x.txt"),
      name: "x.txt",
      userId: "user-a",
      folderId: null,
      view: { type: "club", clubId: "club-a", clubName: "Club A" },
    }, fake.client, fake.dependencies)).rejects.toBe(denied);
    expect(fake.events).toEqual(["reserve"]);
  });

  it("releases the reservation without metadata or compensation when storage upload fails", async () => {
    const uploadError = { message: "storage unavailable" };
    const fake = uploadTransaction({ uploadError });
    await expect(uploadVaultItem({
      kind: "file",
      file: new File(["x"], "x.txt"),
      name: "x.txt",
      userId: "user-a",
      folderId: null,
      view: { type: "club", clubId: "club-a", clubName: "Club A" },
    }, fake.client, fake.dependencies)).rejects.toBe(uploadError);
    expect(fake.events).toEqual(["reserve", "upload", "settle:false"]);
  });

  it("removes the orphan before releasing quota when metadata insertion fails", async () => {
    const insertError = { message: "permission denied", code: "42501" };
    const fake = uploadTransaction({ insertError });
    await expect(uploadVaultItem({
      kind: "photo",
      file: new File(["x"], "x.jpg", { type: "image/jpeg" }),
      name: "x.jpg",
      userId: "user-a",
      folderId: null,
      view: { type: "root" },
    }, fake.client, fake.dependencies)).rejects.toBe(insertError);
    expect(fake.events).toEqual(["reserve", "upload", "insert", "compensate", "settle:false"]);
    expect(fake.dependencies.reserveStorage).toHaveBeenCalledWith(null, 1);
  });
});
