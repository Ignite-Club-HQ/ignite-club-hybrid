import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  createVaultFolder,
  createVaultLinkFile,
  deleteVaultFolder,
  moveVaultFile,
  permanentlyDeleteVaultFile,
  permanentlyDeleteVaultPhoto,
  renameVaultFolder,
  renameVaultItem,
  restoreVaultItem,
  softDeleteVaultItem,
} from "./vaultMutationRepository";

type IgniteSupabaseClient = SupabaseClient<Database>;
type Write = { table: string; payload: unknown; filters: Array<[string, unknown]> };

function mutationClient(error: unknown = null) {
  const writes: Write[] = [];
  const from = (table: string) => {
    let write: Write;
    const query: Record<string, unknown> = {};
    query.update = (payload: unknown) => {
      write = { table, payload, filters: [] };
      writes.push(write);
      return query;
    };
    query.eq = (column: string, value: unknown) => {
      write.filters.push([column, value]);
      return query;
    };
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: null, error }).then(resolve, reject);
    return query;
  };
  return { client: { from } as unknown as IgniteSupabaseClient, writes };
}

describe("Vault rename and move repository", () => {
  it("renames only the exact folder row", async () => {
    const fake = mutationClient();
    await renameVaultFolder("folder-a", "Policies", fake.client);
    expect(fake.writes).toEqual([{
      table: "vault_folders",
      payload: { name: "Policies" },
      filters: [["id", "folder-a"]],
    }]);
  });

  it("uses the same exact vault_files contract for photo and document names", async () => {
    const fake = mutationClient();
    await renameVaultItem("file-a", "Rules.pdf", fake.client);
    await renameVaultItem("photo-a", "Final photo", fake.client);
    expect(fake.writes).toEqual([
      { table: "vault_files", payload: { name: "Rules.pdf" }, filters: [["id", "file-a"]] },
      { table: "vault_files", payload: { name: "Final photo" }, filters: [["id", "photo-a"]] },
    ]);
  });

  it("moves within folders without altering team scope when targetTeamId is omitted", async () => {
    const fake = mutationClient();
    await moveVaultFile({ fileId: "file-a", targetFolderId: "folder-b" }, fake.client);
    expect(fake.writes[0]).toEqual({
      table: "vault_files",
      payload: { folder_id: "folder-b" },
      filters: [["id", "file-a"]],
    });
    expect(fake.writes[0]?.payload).not.toHaveProperty("team_id");
  });

  it("can explicitly move a file to a team or clear its team", async () => {
    const fake = mutationClient();
    await moveVaultFile({ fileId: "file-a", targetFolderId: null, targetTeamId: "team-b" }, fake.client);
    await moveVaultFile({ fileId: "file-b", targetFolderId: null, targetTeamId: null }, fake.client);
    expect(fake.writes.map((write) => write.payload)).toEqual([
      { folder_id: null, team_id: "team-b" },
      { folder_id: null, team_id: null },
    ]);
  });

  it("propagates the original database failure without claiming success", async () => {
    const denied = { code: "42501", message: "permission denied" };
    const fake = mutationClient(denied);
    await expect(renameVaultItem("file-a", "Denied", fake.client)).rejects.toBe(denied);
  });
});

type LifecycleWrite = {
  table: string;
  kind: "insert" | "update" | "delete";
  payload?: unknown;
  filters: Array<[string, unknown]>;
};

function lifecycleClient(error: unknown = null) {
  const writes: LifecycleWrite[] = [];
  const from = (table: string) => {
    let write: LifecycleWrite;
    const query: Record<string, unknown> = {};
    query.insert = (payload: unknown) => {
      write = { table, kind: "insert", payload, filters: [] };
      writes.push(write);
      return query;
    };
    query.update = (payload: unknown) => {
      write = { table, kind: "update", payload, filters: [] };
      writes.push(write);
      return query;
    };
    query.delete = () => {
      write = { table, kind: "delete", filters: [] };
      writes.push(write);
      return query;
    };
    query.eq = (column: string, value: unknown) => {
      write.filters.push([column, value]);
      return query;
    };
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: null, error }).then(resolve, reject);
    return query;
  };
  return { client: { from } as unknown as IgniteSupabaseClient, writes };
}

describe("Vault folder and trash-state mutations", () => {
  it("creates a club folder with exact creator, parent, and club scope", async () => {
    const fake = lifecycleClient();
    await createVaultFolder({
      name: "Policies",
      userId: "user-a",
      parentFolderId: "parent-a",
      view: { type: "club", clubId: "club-a", clubName: "Club A" },
    }, fake.client);
    expect(fake.writes).toEqual([{
      table: "vault_folders",
      kind: "insert",
      payload: {
        name: "Policies",
        created_by: "user-a",
        parent_id: "parent-a",
        club_id: "club-a",
      },
      filters: [],
    }]);
  });

  it("adds exact club and team scope when creating a team folder", async () => {
    const fake = lifecycleClient();
    await createVaultFolder({
      name: "Team files",
      userId: "user-a",
      parentFolderId: null,
      view: {
        type: "team",
        clubId: "club-a",
        clubName: "Club A",
        teamId: "team-a",
        teamName: "Team A",
      },
    }, fake.client);
    expect(fake.writes[0]?.payload).toEqual({
      name: "Team files",
      created_by: "user-a",
      parent_id: null,
      club_id: "club-a",
      team_id: "team-a",
    });
  });

  it("preserves the existing non-club/team folder payload without inventing scope", async () => {
    const fake = lifecycleClient();
    await createVaultFolder({
      name: "Unsupported context",
      userId: "user-a",
      parentFolderId: null,
      view: { type: "root" },
    }, fake.client);
    expect(fake.writes[0]?.payload).toEqual({
      name: "Unsupported context",
      created_by: "user-a",
      parent_id: null,
    });
  });

  it("adds an external link file scoped to a club view", async () => {
    const fake = lifecycleClient();
    await createVaultLinkFile({
      url: "https://reference.invalid/doc",
      name: "Handbook",
      userId: "user-a",
      folderId: "folder-a",
      view: { type: "club", clubId: "club-a", clubName: "Club A" },
    }, fake.client);
    expect(fake.writes).toEqual([{
      table: "vault_files",
      kind: "insert",
      payload: {
        file_url: "https://reference.invalid/doc",
        uploaded_by: "user-a",
        name: "Handbook",
        folder_id: "folder-a",
        is_external_link: true,
        file_size: 0,
        club_id: "club-a",
      },
      filters: [],
    }]);
  });

  it("adds exact club and team scope when adding a link inside a team view", async () => {
    const fake = lifecycleClient();
    await createVaultLinkFile({
      url: "https://reference.invalid/doc",
      name: "Handbook",
      userId: "user-a",
      folderId: null,
      view: {
        type: "team",
        clubId: "club-a",
        clubName: "Club A",
        teamId: "team-a",
        teamName: "Team A",
      },
    }, fake.client);
    expect(fake.writes[0]?.payload).toEqual({
      file_url: "https://reference.invalid/doc",
      uploaded_by: "user-a",
      name: "Handbook",
      folder_id: null,
      is_external_link: true,
      file_size: 0,
      club_id: "club-a",
      team_id: "team-a",
    });
  });

  it("adds exact club and mini-league scope when adding a link inside a mini-league view", async () => {
    const fake = lifecycleClient();
    await createVaultLinkFile({
      url: "https://reference.invalid/doc",
      name: "Handbook",
      userId: "user-a",
      folderId: null,
      view: {
        type: "mini-league",
        clubId: "club-a",
        clubName: "Club A",
        miniLeagueId: "league-a",
        miniLeagueName: "League A",
      },
    }, fake.client);
    expect(fake.writes[0]?.payload).toEqual({
      file_url: "https://reference.invalid/doc",
      uploaded_by: "user-a",
      name: "Handbook",
      folder_id: null,
      is_external_link: true,
      file_size: 0,
      club_id: "club-a",
      mini_league_id: "league-a",
    });
  });

  it("adds no scope id at all for the root view, matching the upload flow's un-scoped insert", async () => {
    const fake = lifecycleClient();
    await createVaultLinkFile({
      url: "https://reference.invalid/doc",
      name: "Handbook",
      userId: "user-a",
      folderId: null,
      view: { type: "root" },
    }, fake.client);
    expect(fake.writes[0]?.payload).toEqual({
      file_url: "https://reference.invalid/doc",
      uploaded_by: "user-a",
      name: "Handbook",
      folder_id: null,
      is_external_link: true,
      file_size: 0,
    });
  });

  it("propagates insert failures for link files", async () => {
    const denied = { message: "permission denied" };
    const fake = lifecycleClient(denied);
    await expect(createVaultLinkFile({
      url: "https://reference.invalid/doc",
      name: "Handbook",
      userId: "user-a",
      folderId: null,
      view: { type: "club", clubId: "club-a", clubName: "Club A" },
    }, fake.client)).rejects.toBe(denied);
  });

  it("deletes only the exact folder row", async () => {
    const fake = lifecycleClient();
    await deleteVaultFolder("folder-a", fake.client);
    expect(fake.writes).toEqual([{
      table: "vault_folders",
      kind: "delete",
      filters: [["id", "folder-a"]],
    }]);
  });

  it("soft-deletes the exact file with the supplied actor and timestamp", async () => {
    const fake = lifecycleClient();
    const deletedAt = new Date("2026-08-07T10:00:00.000Z");
    await expect(softDeleteVaultItem("file-a", "user-a", deletedAt, fake.client)).resolves.toBe("file-a");
    expect(fake.writes).toEqual([{
      table: "vault_files",
      kind: "update",
      payload: { deleted_at: "2026-08-07T10:00:00.000Z", deleted_by: "user-a" },
      filters: [["id", "file-a"]],
    }]);
  });

  it("restores only the exact row and clears both deletion fields", async () => {
    const fake = lifecycleClient();
    await expect(restoreVaultItem("file-a", fake.client)).resolves.toBe("file-a");
    expect(fake.writes).toEqual([{
      table: "vault_files",
      kind: "update",
      payload: { deleted_at: null, deleted_by: null },
      filters: [["id", "file-a"]],
    }]);
  });

  it("propagates lifecycle write failures", async () => {
    const denied = { code: "42501", message: "permission denied" };
    const fake = lifecycleClient(denied);
    await expect(deleteVaultFolder("folder-a", fake.client)).rejects.toBe(denied);
  });
});

function permanentDeleteClient(options: {
  vaultFile?: { file_url: string | null } | null;
  photoRecord?: { id: string } | null;
  invokeError?: { message: string } | null;
} = {}) {
  const reads: Array<{ table: string; select: string; filters: Array<[string, unknown]> }> = [];
  const invoke = async (name: string, request: unknown) => ({
    data: null,
    error: options.invokeError ?? null,
    name,
    request,
  });
  const from = (table: string) => {
    const read = { table, select: "", filters: [] as Array<[string, unknown]> };
    const query = {
      select(columns: string) {
        read.select = columns;
        reads.push(read);
        return query;
      },
      eq(column: string, value: unknown) {
        read.filters.push([column, value]);
        return query;
      },
      async maybeSingle() {
        return {
          data: table === "vault_files"
            ? (options.vaultFile === undefined ? { file_url: "https://files/photo-a.jpg" } : options.vaultFile)
            : (options.photoRecord === undefined ? { id: "photo-row-a" } : options.photoRecord),
          error: null,
        };
      },
    };
    return query;
  };
  const client = { from, functions: { invoke } } as unknown as IgniteSupabaseClient;
  return { client, reads, invoke: vi.fn(invoke) };
}

describe("Vault permanent single-item deletion", () => {
  it("resolves the legacy photo mirror and deletes both exact records through the server boundary", async () => {
    const fake = permanentDeleteClient();
    fake.client.functions.invoke = fake.invoke;

    await expect(permanentlyDeleteVaultPhoto("file-a", fake.client)).resolves.toBe("file-a");

    expect(fake.reads).toEqual([
      { table: "vault_files", select: "file_url", filters: [["id", "file-a"]] },
      { table: "photos", select: "id", filters: [["image_url", "https://files/photo-a.jpg"]] },
    ]);
    expect(fake.invoke).toHaveBeenCalledWith("permanent-delete-photos", {
      body: { photoIds: ["photo-row-a"], fileIds: ["file-a"], deletionType: "permanent" },
    });
  });

  it("still deletes the Vault row when no legacy photo mirror exists", async () => {
    const fake = permanentDeleteClient({ photoRecord: null });
    fake.client.functions.invoke = fake.invoke;

    await permanentlyDeleteVaultPhoto("file-a", fake.client);

    expect(fake.invoke).toHaveBeenCalledWith("permanent-delete-photos", {
      body: { photoIds: [], fileIds: ["file-a"], deletionType: "permanent" },
    });
  });

  it("does not query photos when the Vault row has no file URL", async () => {
    const fake = permanentDeleteClient({ vaultFile: { file_url: null } });
    fake.client.functions.invoke = fake.invoke;

    await permanentlyDeleteVaultPhoto("file-a", fake.client);

    expect(fake.reads).toEqual([
      { table: "vault_files", select: "file_url", filters: [["id", "file-a"]] },
    ]);
  });

  it("permanently deletes a file by exact ID without a photo lookup", async () => {
    const fake = permanentDeleteClient();
    fake.client.functions.invoke = fake.invoke;

    await permanentlyDeleteVaultFile("file-a", fake.client);

    expect(fake.reads).toEqual([]);
    expect(fake.invoke).toHaveBeenCalledWith("permanent-delete-photos", {
      body: { fileIds: ["file-a"], deletionType: "permanent" },
    });
  });

  it("propagates the Edge Function message and never reports success", async () => {
    const fake = permanentDeleteClient({ invokeError: { message: "permission denied" } });
    fake.client.functions.invoke = fake.invoke;

    await expect(permanentlyDeleteVaultFile("file-a", fake.client)).rejects.toThrow("permission denied");
  });
});
