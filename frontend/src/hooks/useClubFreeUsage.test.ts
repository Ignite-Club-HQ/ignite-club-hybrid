import { describe, expect, it } from "vitest";
import {
  FREE_CHAT_PHOTOS_PER_CYCLE,
  FREE_FILE_STORAGE_BYTES,
  FREE_PHOTO_UPLOADS_PER_CYCLE,
  resolveClubFreeUsage,
} from "./useClubFreeUsage";

describe("resolveClubFreeUsage", () => {
  it("keeps a free club below every cap", () => {
    const usage = resolveClubFreeUsage({ photo_uploads_this_cycle: FREE_PHOTO_UPLOADS_PER_CYCLE - 1, chat_photo_uploads_this_cycle: FREE_CHAT_PHOTOS_PER_CYCLE - 1, file_count: 9, file_storage_bytes: FREE_FILE_STORAGE_BYTES - 1, chat_file_uploads_this_cycle: 9, chat_file_storage_bytes: FREE_FILE_STORAGE_BYTES - 1, polls_this_cycle: 1, is_pro: false });
    expect([usage.photo.atCap, usage.chatPhoto.atCap, usage.file.atCap, usage.chatFile.atCap, usage.poll.atCap]).toEqual([false, false, false, false, false]);
  });

  it("blocks each free resource exactly at its limit", () => {
    const usage = resolveClubFreeUsage({ photo_uploads_this_cycle: 20, chat_photo_uploads_this_cycle: 20, file_count: 10, chat_file_uploads_this_cycle: 10, polls_this_cycle: 2, is_pro: false });
    expect([usage.photo.atCap, usage.chatPhoto.atCap, usage.file.atCap, usage.chatFile.atCap, usage.poll.atCap]).toEqual([true, true, true, true, true]);
  });

  it("blocks file uploads when bytes are exhausted before count", () => {
    const usage = resolveClubFreeUsage({ file_count: 1, file_storage_bytes: FREE_FILE_STORAGE_BYTES, chat_file_uploads_this_cycle: 1, chat_file_storage_bytes: FREE_FILE_STORAGE_BYTES, is_pro: false });
    expect(usage.file).toMatchObject({ atCountCap: false, atStorageCap: true, atCap: true });
    expect(usage.chatFile).toMatchObject({ atCountCap: false, atStorageCap: true, atCap: true });
  });

  it("never applies free caps to a Pro club while preserving usage", () => {
    const usage = resolveClubFreeUsage({ photo_uploads_this_cycle: 200, file_count: 100, file_storage_bytes: FREE_FILE_STORAGE_BYTES * 3, polls_this_cycle: 20, is_pro: true });
    expect(usage.photo.used).toBe(200);
    expect([usage.photo.atCap, usage.file.atCap, usage.poll.atCap]).toEqual([false, false, false]);
  });

  it("normalises absent counters to zero and parses cycle boundaries", () => {
    const usage = resolveClubFreeUsage({ cycle_start: "2026-07-01T00:00:00Z", cycle_end: "2026-08-01T00:00:00Z" });
    expect(usage.photo.used).toBe(0);
    expect(usage.cycleStart?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});
