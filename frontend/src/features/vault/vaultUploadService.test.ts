import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  buildVaultUploadPath,
  getVaultUploadScope,
  uploadVaultItem,
  type VaultUploadDependencies,
} from "./vaultUploadService";
import { createVaultLinkFile as createVaultExternalLink } from "./vaultMutationRepository";

type IgniteSupabaseClient = SupabaseClient<Database>;
const uploadMocks = vi.hoisted(() => ({
  mode: (process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase") as "icp" | "supabase",
  registerFile: vi.fn(),
  beginUpload: vi.fn().mockResolvedValue(undefined),
  acknowledgeUpload: vi.fn().mockResolvedValue(undefined),
}));
const supabaseMode = process.env.IGNITE_TEST_BACKEND_MODE !== "icp";
vi.mock("./clubMediaAllowance", () => ({ uploadWithinClubMediaAllowance: (_club: unknown, _bytes: unknown, upload: () => Promise<unknown>) => upload() }));
const icpContext = { identity: { getPrincipal: () => "principal-a" }, target: { alias: "test" } };

vi.mock("@/live/loadBackendRouting", () => ({
  isFeatureRoutedToIcp: (feature: string) => feature === "vault" && uploadMocks.mode === "icp",
}));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    uploadMocks.mode === "icp" ? providers.icp(icpContext) : providers.supabase(),
}));
vi.mock("@/live/features/vault", () => ({
  registerLiveVaultFile: (...args: unknown[]) => uploadMocks.registerFile(...args),
  beginLiveVaultUpload: (...args: unknown[]) => uploadMocks.beginUpload(...args),
  acknowledgeLiveVaultUpload: (...args: unknown[]) => uploadMocks.acknowledgeUpload(...args),
}));

describe("Vault upload scope and storage paths", () => {
  it("builds exact club, team, mini-league, and competition scope fields", () => {
    expect(getVaultUploadScope({ type: "club", clubId: "club-a", clubName: "Club A" }))
      .toEqual({ club_id: "club-a" });
    expect(getVaultUploadScope({
      type: "team", clubId: "club-a", clubName: "Club A", teamId: "team-a", teamName: "Team A",
    })).toEqual({ club_id: "club-a", team_id: "team-a" });
    expect(getVaultUploadScope({
      type: "mini-league", clubId: "club-a", clubName: "Club A",
      miniLeagueId: "league-a", miniLeagueName: "League A",
    })).toEqual({ club_id: "club-a", mini_league_id: "league-a" });
    expect(getVaultUploadScope({
      type: "competition", clubId: "club-a", clubName: "Club A",
      competitionId: "competition-a", competitionName: "Competition A",
    })).toEqual({ club_id: "club-a", competition_id: "competition-a" });
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

  it("builds club, mini-league, competition, and unassigned paths without cross-scope IDs", () => {
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
    expect(buildVaultUploadPath({
      ...stable,
      view: {
        type: "competition", clubId: "club-a", clubName: "Club A",
        competitionId: "competition-a", competitionName: "Competition A",
      },
    })).toBe("clubs/club-a/competitions/competition-a/user-a/123-.jpg");
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

describe.runIf(supabaseMode)("Vault external-link creation — Supabase", () => {
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

  it("applies competition scope without inventing a team ID", async () => {
    const fake = insertClient();
    await createVaultExternalLink({
      url: "https://example.com/rules",
      name: "Competition rules",
      userId: "user-a",
      folderId: null,
      view: {
        type: "competition", clubId: "club-a", clubName: "Club A",
        competitionId: "competition-a", competitionName: "Competition A",
      },
    }, fake.client);
    expect(fake.inserts[0]).toMatchObject({ club_id: "club-a", competition_id: "competition-a" });
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
  const uploadBuckets: string[] = [];
  const upload = vi.fn(async () => {
    events.push("upload");
    return { data: null, error: options.uploadError ?? null };
  });
  const client = {
    storage: { from: (bucket: string) => { uploadBuckets.push(bucket); return { upload }; } },
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
  return { client, dependencies, events, inserts, upload, uploadBuckets };
}

describe.runIf(supabaseMode)("Vault upload transaction — Supabase", () => {
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

  it("stores competition files in the private competition bucket with competition metadata", async () => {
    const fake = uploadTransaction();
    const file = new File(["rules"], "rules.pdf", { type: "application/pdf" });
    await uploadVaultItem({
      kind: "file",
      file,
      name: "Competition rules",
      userId: "user-a",
      folderId: null,
      view: {
        type: "competition",
        clubId: "club-a",
        clubName: "Club A",
        competitionId: "competition-a",
        competitionName: "Competition A",
      },
    }, fake.client, fake.dependencies);

    expect(fake.uploadBuckets).toEqual(["competition-vault"]);
    expect(fake.upload.mock.calls[0][0]).toContain("clubs/club-a/competitions/competition-a/");
    expect(fake.inserts[0]).toMatchObject({
      club_id: "club-a",
      competition_id: "competition-a",
      storage_bucket: "competition-vault",
    });
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

describe.runIf(!supabaseMode)("Vault upload transaction — ICP", () => {
  it("journals exact provenance before bytes and acknowledges before registering", async () => {
    uploadMocks.mode = "icp";
    const events: string[] = [];
    uploadMocks.beginUpload.mockImplementation(async () => { events.push("intent"); });
    uploadMocks.acknowledgeUpload.mockImplementation(async () => { events.push("acknowledge"); });
    uploadMocks.registerFile.mockImplementation(async () => { events.push("register"); });
    const ref = { canister: "store-a", path: "clubs/club-a/vault/document", content_hash: "cipher-hash" };
    const tryBlobUpload = vi.fn(async (args) => {
      await args.beforeUpload(ref);
      events.push("bytes");
      return { url: `https://${ref.canister}.raw.icp0.io/${ref.path}`, blobRef: ref };
    });
    const fake = uploadTransaction();
    await uploadVaultItem({ kind: "file", file: new File(["x"], "x.pdf"), name: "x.pdf", userId: "principal-a", folderId: null, view: { type: "club", clubId: "club-a", clubName: "Club A" } }, fake.client, { ...fake.dependencies, tryBlobUpload });
    expect(events).toEqual(["intent", "bytes", "acknowledge", "register"]);
    const intent = uploadMocks.beginUpload.mock.calls.at(-1)?.[1];
    expect(intent).toMatchObject({ club: "club-a", size: 1n, blob_ref: [ref], uploaded_by: "principal-a" });
    expect(uploadMocks.acknowledgeUpload.mock.calls.at(-1)?.[1]).toBe(intent.id);
    expect(uploadMocks.registerFile.mock.calls.at(-1)?.[1]).toBe(intent.id);
    expect(fake.dependencies.compensateUpload).not.toHaveBeenCalled();
    uploadMocks.beginUpload.mockReset().mockResolvedValue(undefined);
    uploadMocks.acknowledgeUpload.mockReset().mockResolvedValue(undefined);
    uploadMocks.registerFile.mockReset().mockResolvedValue(undefined);
  });
  it("stops before sending bytes when durable intent is refused", async () => {
    uploadMocks.mode = "icp";
    const denied = new Error("intent unavailable");
    uploadMocks.beginUpload.mockRejectedValueOnce(denied);
    const bytes = vi.fn(); const fake = uploadTransaction();
    const tryBlobUpload = vi.fn(async args => { await args.beforeUpload({ canister: "store-a", path: "clubs/club-a/vault/x", content_hash: "hash" }); bytes(); return null; });
    await expect(uploadVaultItem({ kind: "file", file: new File(["x"], "x.txt"), name: "x", userId: "principal-a", folderId: null, view: { type: "club", clubId: "club-a", clubName: "Club A" } }, fake.client, { ...fake.dependencies, tryBlobUpload })).rejects.toBe(denied);
    expect(bytes).not.toHaveBeenCalled();
    expect(fake.dependencies.compensateUpload).not.toHaveBeenCalled();
  });
  it("uploads encrypted bytes and registers metadata without Supabase storage or quota calls", async () => {
    uploadMocks.mode = "icp";
    uploadMocks.registerFile.mockReset().mockResolvedValue(undefined);
    const fake = uploadTransaction();
    const file = new File(["document"], "rules.pdf", { type: "application/pdf" });
    const tryBlobUpload = vi.fn().mockResolvedValue({ url: "https://icp.invalid/blob", blobRef: "blob-ref-a" });

    await uploadVaultItem({
      kind: "file",
      file,
      name: "Competition rules",
      userId: "principal-a",
      folderId: "folder-a",
      view: { type: "competition", clubId: "club-a", clubName: "Club A", competitionId: "competition-a", competitionName: "Competition A" },
    }, fake.client, { ...fake.dependencies, tryBlobUpload });

    expect(tryBlobUpload).toHaveBeenCalledWith(expect.objectContaining({
      file,
      lock: "own",
      competitionId: "competition-a",
    }));
    expect(uploadMocks.registerFile).toHaveBeenCalledWith(
      icpContext,
      expect.any(String),
      "folder-a",
      "club-a",
      null,
      "Competition rules",
      "https://icp.invalid/blob",
      file.size,
      "application/pdf",
      false,
      "blob-ref-a",
      null,
      "competition-a",
    );
    expect(fake.upload).not.toHaveBeenCalled();
    expect(fake.inserts).toEqual([]);
    expect(fake.dependencies.reserveStorage).not.toHaveBeenCalled();
  });

  it("fails closed when the blob store is unavailable without falling back to Supabase", async () => {
    uploadMocks.mode = "icp";
    uploadMocks.registerFile.mockReset();
    const fake = uploadTransaction();
    const tryBlobUpload = vi.fn().mockResolvedValue(null);
    await expect(uploadVaultItem({
      kind: "file",
      file: new File(["x"], "x.txt"),
      name: "x.txt",
      userId: "principal-a",
      folderId: null,
      view: { type: "club", clubId: "club-a", clubName: "Club A" },
    }, fake.client, { ...fake.dependencies, tryBlobUpload })).rejects.toThrow(/media canisters are configured/i);
    expect(fake.upload).not.toHaveBeenCalled();
    expect(fake.inserts).toEqual([]);
    expect(fake.dependencies.reserveStorage).not.toHaveBeenCalled();
  });

  it("rejects missing club scope before uploading encrypted bytes", async () => {
    uploadMocks.mode = "icp";
    const fake = uploadTransaction();
    const tryBlobUpload = vi.fn().mockResolvedValue({ url: "https://icp.invalid/blob", blobRef: "blob-ref-a" });

    await expect(uploadVaultItem({
      kind: "file",
      file: new File(["x"], "x.txt"),
      name: "x.txt",
      userId: "principal-a",
      folderId: null,
      view: { type: "root" },
    }, fake.client, { ...fake.dependencies, tryBlobUpload })).rejects.toThrow(/club scope/i);

    expect(tryBlobUpload).not.toHaveBeenCalled();
    expect(uploadMocks.registerFile).not.toHaveBeenCalled();
    expect(fake.upload).not.toHaveBeenCalled();
    expect(fake.dependencies.reserveStorage).not.toHaveBeenCalled();
  });

  it("propagates encrypted blob upload failure without Supabase fallback", async () => {
    uploadMocks.mode = "icp";
    const denied = new Error("blob upload denied");
    const fake = uploadTransaction();
    const tryBlobUpload = vi.fn().mockRejectedValue(denied);

    await expect(uploadVaultItem({
      kind: "file",
      file: new File(["x"], "x.txt"),
      name: "x.txt",
      userId: "principal-a",
      folderId: null,
      view: { type: "club", clubId: "club-a", clubName: "Club A" },
    }, fake.client, { ...fake.dependencies, tryBlobUpload })).rejects.toBe(denied);

    expect(uploadMocks.registerFile).not.toHaveBeenCalled();
    expect(fake.upload).not.toHaveBeenCalled();
    expect(fake.dependencies.reserveStorage).not.toHaveBeenCalled();
  });

  it("propagates canister metadata registration failure without Supabase fallback", async () => {
    uploadMocks.mode = "icp";
    const denied = new Error("vault metadata denied");
    uploadMocks.registerFile.mockRejectedValueOnce(denied);
    const fake = uploadTransaction();
    const tryBlobUpload = vi.fn().mockResolvedValue({ url: "https://icp.invalid/blob", blobRef: "blob-ref-a" });

    await expect(uploadVaultItem({
      kind: "file",
      file: new File(["x"], "x.txt"),
      name: "x.txt",
      userId: "principal-a",
      folderId: null,
      view: { type: "club", clubId: "club-a", clubName: "Club A" },
    }, fake.client, { ...fake.dependencies, tryBlobUpload })).rejects.toBe(denied);

    expect(uploadMocks.registerFile).toHaveBeenCalledOnce();
    expect(fake.upload).not.toHaveBeenCalled();
    expect(fake.inserts).toEqual([]);
    expect(fake.dependencies.reserveStorage).not.toHaveBeenCalled();
  });
});
