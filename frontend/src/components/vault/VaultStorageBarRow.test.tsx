import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { VaultStorageBarRow } from "@/components/vault/VaultStorageBarRow";

function Harness({ onRename = vi.fn(), onDelete = vi.fn() }) {
  return (
    <Collapsible>
      <VaultStorageBarRow
        storagePercentage={42}
        usageLabel="2.1 GB / 5 GB"
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" aria-label="Storage actions">
                ...
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete}>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <CollapsibleContent>Storage details</CollapsibleContent>
    </Collapsible>
  );
}

describe("VaultStorageBarRow", () => {
  it("emits no validateDOMNesting warning (no button inside a button)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<Harness />);

    expect(
      errorSpy.mock.calls.some((call) => String(call[0]).includes("validateDOMNesting"))
    ).toBe(false);

    container.querySelectorAll("button").forEach((btn) => {
      expect(btn.querySelector("button")).toBeNull();
    });
    errorSpy.mockRestore();
  });

  it("activates the collapsible with mouse and keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /toggle storage details/i });

    await user.click(trigger);
    expect(screen.getByText("Storage details")).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.queryByText("Storage details")).not.toBeInTheDocument();

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Storage details")).toBeInTheDocument();
    await user.keyboard(" ");
    expect(screen.queryByText("Storage details")).not.toBeInTheDocument();
  });

  it("opens the action menu independently without toggling the collapsible", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /storage actions/i }));

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Rename")).toBeInTheDocument();
    expect(screen.queryByText("Storage details")).not.toBeInTheDocument();
  });

  it("keeps rename/delete reachable with the keyboard", async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();
    render(<Harness onRename={onRename} />);

    screen.getByRole("button", { name: /storage actions/i }).focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await screen.findByText("Rename");
    await user.keyboard("{Enter}");


    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Storage details")).not.toBeInTheDocument();
  });
});
