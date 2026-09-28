/**
 * Tests for `ChildAndSecondGuardianFields`, extracted from
 * `AddTeamMemberSheet` after both its "existing user, parent role" and "new
 * member, parent role" branches rendered the identical 260+ line child/second
 * -guardian block verbatim (differing only in one microcopy string). These
 * tests cover the shared rendering/interaction contract in isolation; no
 * network or Supabase call is involved.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import {
  ChildAndSecondGuardianFields,
  type BulkChild,
  type ChildMatchCandidate,
  type ExistingClubChildRow,
  type SecondParentProfile,
} from "./ChildAndSecondGuardianFields";

afterEach(cleanup);

const child = (overrides: Partial<BulkChild> = {}): BulkChild => ({
  id: overrides.id ?? "child-1",
  name: overrides.name ?? "",
  yearOfBirth: overrides.yearOfBirth ?? "",
  jerseyNumber: overrides.jerseyNumber ?? "",
  ...overrides,
});

const baseProps = () => ({
  singleChildren: [child()] as BulkChild[],
  setSingleChildren: vi.fn(),
  findMatchingChildren: vi.fn((_name: string) => [] as ChildMatchCandidate[]),
  clubChildren: [] as ExistingClubChildRow[],
  selectedSecondParent: null as SecondParentProfile | null,
  setSelectedSecondParent: vi.fn(),
  secondParentSearch: "",
  setSecondParentSearch: vi.fn(),
  secondParentName: "",
  setSecondParentName: vi.fn(),
  secondParentEmail: "",
  setSecondParentEmail: vi.fn(),
  filteredSecondParentResults: [] as SecondParentProfile[],
  secondParentJoinDescription: "Will be added directly",
});

describe("ChildAndSecondGuardianFields", () => {
  it("shows the loading placeholder when singleChildren is empty", () => {
    render(<ChildAndSecondGuardianFields {...baseProps()} singleChildren={[]} />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Child's name")).not.toBeInTheDocument();
  });

  it("renders a name input per child and calls setSingleChildren with a reset match on edit", () => {
    const props = baseProps();
    render(<ChildAndSecondGuardianFields {...props} />);
    fireEvent.change(screen.getByPlaceholderText("Child's name"), { target: { value: "Ava" } });
    expect(props.setSingleChildren).toHaveBeenCalledTimes(1);
    const updated = props.setSingleChildren.mock.calls[0][0] as BulkChild[];
    expect(updated[0]).toMatchObject({ name: "Ava", existingChildId: undefined, confirmedNew: undefined });
  });

  it("hides the second-parent/guardian section entirely when there are no children yet", () => {
    render(<ChildAndSecondGuardianFields {...baseProps()} singleChildren={[]} />);
    expect(screen.queryByText("Second Parent / Guardian")).not.toBeInTheDocument();
  });

  it("shows the second-parent/guardian section once at least one child row exists", () => {
    render(<ChildAndSecondGuardianFields {...baseProps()} />);
    expect(screen.getByText("Second Parent / Guardian")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search by name or email, or type new")).toBeInTheDocument();
  });

  it("renders the confirmed-match banner and links to an existing (non-pending) child", () => {
    const match: ChildMatchCandidate = {
      id: "existing-1",
      name: "Ava Smith",
      year_of_birth: 2015,
      parent_id: "parent-1",
      parent_name: "Jo Smith",
      isPending: false,
    };
    const props = baseProps();
    props.findMatchingChildren = vi.fn(() => [match]);
    props.singleChildren = [child({ name: "Ava" })];
    render(<ChildAndSecondGuardianFields {...props} />);

    expect(screen.getByText(/already exists \(parent: Jo Smith\)\. Link to them\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Link to existing" }));

    const updated = props.setSingleChildren.mock.calls.at(-1)?.[0] as BulkChild[];
    expect(updated[0]).toMatchObject({
      name: "Ava Smith",
      existingChildId: "existing-1",
      existingChildParentName: "Jo Smith",
      yearOfBirth: "2015",
    });
  });

  it("renders the pending-invite banner and confirms a same-child match", () => {
    const match: ChildMatchCandidate = {
      id: "pending-1",
      name: "Ben Jones",
      year_of_birth: null,
      parent_id: "parent-2",
      parent_name: "Sam Jones",
      isPending: true,
      inviteId: "invite-1",
    };
    const props = baseProps();
    props.findMatchingChildren = vi.fn(() => [match]);
    props.singleChildren = [child({ name: "Ben" })];
    render(<ChildAndSecondGuardianFields {...props} />);

    expect(screen.getByText(/has a pending invite \(parent: Sam Jones\)\. Same child\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, same child" }));

    const updated = props.setSingleChildren.mock.calls.at(-1)?.[0] as BulkChild[];
    expect(updated[0]).toMatchObject({
      confirmedNew: true,
      pendingInviteId: "invite-1",
      pendingParentName: "Sam Jones",
    });
  });

  it("adds a new child row when 'Add another child' is clicked", () => {
    const props = baseProps();
    render(<ChildAndSecondGuardianFields {...props} />);
    fireEvent.click(screen.getByText("Add another child"));
    const updated = props.setSingleChildren.mock.calls[0][0] as BulkChild[];
    expect(updated).toHaveLength(2);
    expect(updated[1]).toMatchObject({ name: "", yearOfBirth: "", jerseyNumber: "" });
  });

  it("selects a second-parent search result and clears the search text", () => {
    const props = baseProps();
    props.secondParentSearch = "jo";
    props.filteredSecondParentResults = [
      { id: "user-1", display_name: "Jo Doe", avatar_url: null },
    ];
    render(<ChildAndSecondGuardianFields {...props} />);
    fireEvent.click(screen.getByText("Jo Doe"));
    expect(props.setSelectedSecondParent).toHaveBeenCalledWith({ id: "user-1", display_name: "Jo Doe", avatar_url: null });
    expect(props.setSecondParentSearch).toHaveBeenCalledWith("");
    expect(props.setSecondParentEmail).toHaveBeenCalledWith("");
  });

  it("shows the second-parent email field once a name has been typed with no match selected", () => {
    const props = baseProps();
    props.secondParentName = "New Guardian";
    render(<ChildAndSecondGuardianFields {...props} />);
    expect(screen.getByPlaceholderText("Second parent's email")).toBeInTheDocument();
  });

  it("renders the caller-supplied join description for a confirmed second parent, and clears selection on remove", () => {
    const props = baseProps();
    props.selectedSecondParent = { id: "user-2", display_name: "Pat Lee", avatar_url: null };
    props.secondParentJoinDescription = "Joins team immediately";
    render(<ChildAndSecondGuardianFields {...props} />);
    expect(screen.getByText("Pat Lee")).toBeInTheDocument();
    expect(screen.getByText("Joins team immediately")).toBeInTheDocument();

    const secondParentSection = screen.getByText("Second Parent / Guardian").closest("div.space-y-3");
    expect(secondParentSection).not.toBeNull();
    fireEvent.click(within(secondParentSection as HTMLElement).getByRole("button"));
    expect(props.setSelectedSecondParent).toHaveBeenCalledWith(null);
    expect(props.setSecondParentSearch).toHaveBeenCalledWith("");
  });
});
