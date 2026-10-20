/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles mirror flexible query/component contracts */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  context: { identity: {}, target: {} },
  insert: vi.fn(),
  deleteIn: vi.fn(),
  toast: vi.fn(),
  invalidateQueries: vi.fn(),
  invalidateRolesCache: vi.fn(),
  addRole: vi.fn(),
  removeRole: vi.fn(),
  fanOut: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
    useMutation: (options: any) => ({
      isPending: false,
      mutate: async () => {
        try {
          await options.mutationFn();
          options.onSuccess?.();
        } catch (error) {
          options.onError?.(error);
        }
      },
    }),
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/rolesCache", () => ({ invalidateRolesCache: mocks.invalidateRolesCache }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      insert: (rows: any) => mocks.insert(table, rows),
      delete: () => ({ in: (column: string, values: string[]) => mocks.deleteIn(table, column, values) }),
    }),
  },
}));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => mocks.mode }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    mocks.mode === "icp" ? providers.icp(mocks.context) : providers.supabase(),
}));
vi.mock("@/live/features/membership", () => ({
  addLiveRoleGrant: (...args: unknown[]) => mocks.addRole(...args),
  removeLiveRoleGrant: (...args: unknown[]) => mocks.removeRole(...args),
}));
vi.mock("@/live/features/notifications", () => ({ fanOutLiveNotifications: (...args: unknown[]) => mocks.fanOut(...args) }));
vi.mock("@icp-sdk/core/principal", () => ({ Principal: { fromText: (text: string) => ({ text }) } }));

import ManageRolesDialog from "./ManageRolesDialog";

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  userId: "member-2",
  userName: "Alex Member",
  teamId: "team-a",
  teamName: "Rovers U12",
  clubId: "club-a",
  currentRoles: [{ id: "role-player-a", role: "player" }],
  canManage: true,
  onSaved: vi.fn(),
};

describe.runIf(mocks.mode === "supabase")("ManageRolesDialog membership and role isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockResolvedValue({ error: null });
    mocks.deleteIn.mockResolvedValue({ error: null });
  });

  it("does not permit any role mutation when the viewer cannot manage roles", () => {
    render(<ManageRolesDialog {...baseProps} canManage={false} />);
    fireEvent.click(screen.getByText("Coach").closest("button")!);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.deleteIn).not.toHaveBeenCalled();
  });

  it("grants a role with the exact member, team, and club scope", async () => {
    render(<ManageRolesDialog {...baseProps} />);
    fireEvent.click(screen.getByText("Coach").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.insert).toHaveBeenCalledWith("user_roles", [{
      user_id: "member-2", team_id: "team-a", club_id: "club-a", role: "coach",
    }]));
    expect(mocks.deleteIn).not.toHaveBeenCalled();
  });

  it("requires confirmation before removing an existing elevated role", async () => {
    render(<ManageRolesDialog {...baseProps} currentRoles={[{ id: "admin-row", role: "team_admin" }]} />);
    fireEvent.click(screen.getByText("Team Admin").closest("button")!);

    expect(screen.getByText("Remove Team Admin?")).toBeInTheDocument();
    expect(mocks.deleteIn).not.toHaveBeenCalled();
  });

  it("deletes only the selected persisted role row, never every role for the user", async () => {
    render(<ManageRolesDialog {...baseProps} currentRoles={[
      { id: "player-row-team-a", role: "player" },
      { id: "coach-row-team-a", role: "coach" },
    ]} />);
    fireEvent.click(screen.getByText("Coach").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.deleteIn).toHaveBeenCalledWith(
      "user_roles", "id", ["coach-row-team-a"],
    ));
  });

  it("prevents saving a change that would leave the member with no team roles", () => {
    render(<ManageRolesDialog {...baseProps} />);
    fireEvent.click(screen.getByText("Player").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByText(/will have no roles on this team/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("does not delete old roles when adding a replacement role fails", async () => {
    mocks.insert.mockResolvedValueOnce({ error: new Error("grant rejected") });
    render(<ManageRolesDialog {...baseProps} />);
    fireEvent.click(screen.getByText("Player").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByText("Coach").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't update roles", variant: "destructive",
    })));
    expect(mocks.deleteIn).not.toHaveBeenCalled();
    expect(baseProps.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("does not report success or invalidate caches when revocation fails", async () => {
    mocks.deleteIn.mockResolvedValueOnce({ error: new Error("revoke rejected") });
    render(<ManageRolesDialog {...baseProps} currentRoles={[
      { id: "player-row", role: "player" }, { id: "coach-row", role: "coach" },
    ]} />);
    fireEvent.click(screen.getByText("Coach").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't update roles",
    })));
    expect(mocks.invalidateRolesCache).not.toHaveBeenCalled();
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it("invalidates role state only after all membership changes succeed", async () => {
    render(<ManageRolesDialog {...baseProps} />);
    fireEvent.click(screen.getByText("Coach").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.invalidateRolesCache).toHaveBeenCalledOnce());
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["team-roles", "team-a"] });
    expect(baseProps.onSaved).toHaveBeenCalledOnce();
  });
});

describe.runIf(mocks.mode === "icp")("ManageRolesDialog ICP role grants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addRole.mockResolvedValue(undefined);
    mocks.removeRole.mockResolvedValue(undefined);
  });

  it("grants a role through club_domain using the member principal and exact scope", async () => {
    render(<ManageRolesDialog {...baseProps} userId="2vxsx-fae" />);
    fireEvent.click(screen.getByText("Coach").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.addRole).toHaveBeenCalledWith(
      mocks.context,
      { text: "2vxsx-fae" },
      "club-a",
      "coach",
      "team-a",
    ));
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.deleteIn).not.toHaveBeenCalled();
    expect(mocks.invalidateRolesCache).toHaveBeenCalledOnce();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["team-roles", "team-a"] });
  });

  it("revokes only the selected role through club_domain", async () => {
    render(<ManageRolesDialog {...baseProps} userId="2vxsx-fae" currentRoles={[
      { id: "role-player", role: "player" },
      { id: "role-coach", role: "coach" },
    ]} />);
    fireEvent.click(screen.getByText("Coach").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.removeRole).toHaveBeenCalledWith(
      mocks.context,
      { text: "2vxsx-fae" },
      "club-a",
      "coach",
      "team-a",
    ));
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.deleteIn).not.toHaveBeenCalled();
    expect(mocks.invalidateRolesCache).toHaveBeenCalledOnce();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["team-roles", "team-a"] });
  });

  it("does not permit role changes when the viewer cannot manage roles", () => {
    render(<ManageRolesDialog {...baseProps} canManage={false} />);

    fireEvent.click(screen.getByText("Coach").closest("button")!);

    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(mocks.addRole).not.toHaveBeenCalled();
    expect(mocks.removeRole).not.toHaveBeenCalled();
  });

  it("does not invalidate or close when an ICP role grant is denied", async () => {
    mocks.addRole.mockRejectedValueOnce(new Error("grant denied"));
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    render(<ManageRolesDialog {...baseProps} onOpenChange={onOpenChange} onSaved={onSaved} />);
    fireEvent.click(screen.getByText("Coach").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't update roles",
      variant: "destructive",
    })));
    expect(mocks.removeRole).not.toHaveBeenCalled();
    expect(mocks.invalidateRolesCache).not.toHaveBeenCalled();
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("does not report success or invalidate caches when an ICP role revoke is denied", async () => {
    mocks.removeRole.mockRejectedValueOnce(new Error("revoke denied"));
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    render(<ManageRolesDialog {...baseProps} userId="2vxsx-fae" currentRoles={[
      { id: "role-player", role: "player" },
      { id: "role-coach", role: "coach" },
    ]} onOpenChange={onOpenChange} onSaved={onSaved} />);
    fireEvent.click(screen.getByText("Coach").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't update roles",
      variant: "destructive",
    })));
    expect(mocks.invalidateRolesCache).not.toHaveBeenCalled();
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
