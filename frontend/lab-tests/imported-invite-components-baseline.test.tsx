import { expect, test } from "vitest";
import {
  buildInviteSmsUrl,
  buildInviteWhatsAppUrl,
  formatBulkInviteOutcome,
  formatInviteSuccessSummary,
  getInvitationFooterState,
  getInviteDeliveryState,
} from "../src/lab/componentCandidatePolicies";
import {
  getDefaultTeamRole,
  getTeamRoleOptions,
} from "../src/features/membership/invitationPolicy";
import { looksLikeMultiRecipient, parseRecipients } from "../src/components/invite/recipientParser";

test("preserves invite delivery selection, email visibility, and validation", () => {
  expect(getInviteDeliveryState("share", "")).toEqual({
    showEmail: false,
    selectedAction: "Share Link",
    canSubmit: true,
  });
  expect(getInviteDeliveryState("email", "old@example.invalid")).toEqual({
    showEmail: true,
    selectedAction: "Email",
    canSubmit: true,
  });
  expect(getInviteDeliveryState("email", "invalid")).toMatchObject({
    showEmail: true,
    canSubmit: false,
  });
});

test("preserves invitation role policy used by the role step", () => {
  expect(getTeamRoleOptions("junior").map(({ value }) => value))
    .toEqual(["parent", "coach", "team_admin"]);
  expect(getTeamRoleOptions("senior").map(({ value }) => value))
    .toEqual(["player", "coach", "team_admin"]);
  expect(getTeamRoleOptions("mixed").map(({ value }) => value))
    .toEqual(["parent", "player", "coach", "team_admin"]);
  expect(getDefaultTeamRole("junior")).toBe("parent");
  expect(getDefaultTeamRole("senior")).toBe("player");
});

test("preserves invitation footer gating for names, parent children, email, and pending work", () => {
  expect(getInvitationFooterState({
    wizardStep: 1,
    hasMemberIdentity: false,
    hasMemberName: false,
    selectedRole: "player",
    hasNamedChild: false,
    deliveryMethod: "email",
    email: "",
    isPending: false,
  })).toEqual({ canContinue: false, message: "Enter a name to continue" });
  expect(getInvitationFooterState({
    wizardStep: 2,
    hasMemberIdentity: false,
    hasMemberName: true,
    selectedRole: "parent",
    hasNamedChild: false,
    deliveryMethod: "share",
    email: "",
    isPending: false,
  })).toEqual({
    canContinue: false,
    message: "Add at least one child's name to continue.",
  });
  expect(getInvitationFooterState({
    wizardStep: 3,
    hasMemberIdentity: false,
    hasMemberName: true,
    selectedRole: "player",
    hasNamedChild: false,
    deliveryMethod: "email",
    email: "",
    isPending: false,
  })).toEqual({
    canContinue: false,
    message: "Enter an email address to send the invite.",
  });
  expect(getInvitationFooterState({
    wizardStep: 3,
    hasMemberIdentity: false,
    hasMemberName: true,
    selectedRole: "player",
    hasNamedChild: false,
    deliveryMethod: "email",
    email: "invalid",
    isPending: false,
  })).toEqual({ canContinue: false, message: "That email doesn't look right" });
  expect(getInvitationFooterState({
    wizardStep: 3,
    hasMemberIdentity: false,
    hasMemberName: true,
    selectedRole: "player",
    hasNamedChild: false,
    deliveryMethod: "share",
    email: "",
    isPending: false,
  })).toEqual({ canContinue: true, message: null });
  expect(getInvitationFooterState({
    wizardStep: 3,
    hasMemberIdentity: false,
    hasMemberName: true,
    selectedRole: "player",
    hasNamedChild: false,
    deliveryMethod: "email",
    email: "member@example.invalid",
    isPending: true,
  })).toEqual({ canContinue: false, message: null });
});

test("preserves sanitized invite share destinations and outcome wording", () => {
  expect(buildInviteSmsUrl("+61 412 345 678", " Join the team ", true))
    .toBe("sms:+61412345678?body=Join%20the%20team");
  expect(buildInviteSmsUrl("+61 412 345 678", " Join the team ", false))
    .toBe("sms:+61412345678&body=Join%20the%20team");
  expect(buildInviteWhatsAppUrl("+61 412 345 678", " Join the team "))
    .toBe("https://wa.me/61412345678?text=Join%20the%20team");
  expect(formatInviteSuccessSummary(["Child A"], "Under 8 Blue", "parent@example.invalid"))
    .toBe("Child A added to Under 8 Blue; Invite sent to parent@example.invalid");
  expect(formatInviteSuccessSummary(["Child A", "Child B"], "Under 8 Blue", ""))
    .toBe("Child A, Child B added to Under 8 Blue; Invite link created - share it with them");
  expect(formatBulkInviteOutcome({ email: "sent@example.invalid", sent: true })).toBe("Sent");
  expect(formatBulkInviteOutcome({ email: "failed@example.invalid", sent: false })).toBe("Failed");
  expect(formatBulkInviteOutcome({ email: "", sent: false })).toBe("Link only");
});

test("preserves recipient parsing and hardened rejection boundaries", () => {
  expect(parseRecipients("Alice Smith <alice@example.invalid>")).toEqual([
    { name: "Alice Smith", email: "alice@example.invalid" },
  ]);
  expect(parseRecipients("A@example.invalid\na@example.invalid")).toEqual([
    { name: "A", email: "A@example.invalid" },
  ]);
  expect(parseRecipients("Alex <redacted@example.invalid extra>")).toEqual([]);
  expect(parseRecipients("Alex <redacted@example.invalid><redacted@example.invalid>")).toEqual([]);
  expect(parseRecipients("Alex @broken")).toEqual([]);
  expect(looksLikeMultiRecipient("a@example.invalid\nb@example.invalid")).toBe(true);
  expect(looksLikeMultiRecipient("Alice <redacted@example.invalid>")).toBe(false);
});
