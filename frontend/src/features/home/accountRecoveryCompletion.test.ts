import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { completeHomeAccountRecovery } from "./accountRecoveryCompletion";

describe("home account-recovery completion", () => {
  it("refreshes only the admin user-search family that reads deletion state", () => {
    const client = new QueryClient();
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue(undefined);

    completeHomeAccountRecovery(client);

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["search-users-manage"],
    });
  });

  it("does not invalidate unrelated home, event, message, vault or auth state", () => {
    const client = new QueryClient();
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue(undefined);

    completeHomeAccountRecovery(client);

    const serialized = JSON.stringify(invalidate.mock.calls);
    for (const unrelated of [
      "user-memberships-and-events",
      "events",
      "notifications",
      "messages",
      "vault-files",
      "profile",
    ]) {
      expect(serialized).not.toContain(unrelated);
    }
  });
});
