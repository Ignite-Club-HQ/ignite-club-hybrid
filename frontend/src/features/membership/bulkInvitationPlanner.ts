import type { TeamRole } from "./invitationPolicy";
import type { Json } from "@/integrations/supabase/types";

export interface BulkInvitationPlanningChild {
  name: string;
  yearOfBirth?: string;
  jerseyNumber?: string;
  existingChildId?: string;
}

export interface BulkInvitationPlanningMember {
  name: string;
  role: TeamRole;
  children: BulkInvitationPlanningChild[];
  secondParentName?: string;
  secondParentEmail?: string;
  selectedSecondParent?: {
    id: string;
    display_name: string | null;
  } | null;
}

export interface BulkPendingChildMetadata {
  [key: string]: Json | undefined;
  name: string;
  yearOfBirth: number | null;
  jerseyNumber: number | null;
  existingChildId: string | null;
}

export interface BulkPendingInviteMetadata {
  [key: string]: Json | undefined;
  children: BulkPendingChildMetadata[];
  linked_invite_token?: string;
  second_guardian_name?: string | null;
  second_guardian_email?: string;
  second_guardian_user_id?: string;
}

export interface BulkInvitationPlan<T extends BulkInvitationPlanningMember> {
  member: T;
  inviteToken: string;
  linkedInviteToken: string | null;
}

function getParentChildFingerprint(member: BulkInvitationPlanningMember): string | null {
  if (member.role !== "parent") return null;
  const fingerprint = member.children
    .filter((child) => child.name.trim())
    .map((child) => child.name.trim().toLowerCase())
    .sort()
    .join("|");
  return fingerprint || null;
}

export function planBulkInvitations<T extends BulkInvitationPlanningMember>(
  members: T[],
  createToken: () => string = () => crypto.randomUUID(),
): BulkInvitationPlan<T>[] {
  const validMembers = members.filter((member) => member.name.trim());
  if (validMembers.length === 0) {
    throw new Error("Please enter at least one name");
  }

  const plans = validMembers.map((member) => ({
    member,
    inviteToken: createToken(),
    linkedInviteToken: null as string | null,
  }));
  const fingerprintIndexes = new Map<string, number[]>();

  validMembers.forEach((member, index) => {
    const fingerprint = getParentChildFingerprint(member);
    if (!fingerprint) return;
    const indexes = fingerprintIndexes.get(fingerprint) ?? [];
    indexes.push(index);
    fingerprintIndexes.set(fingerprint, indexes);
  });

  for (const indexes of fingerprintIndexes.values()) {
    if (indexes.length !== 2) continue;
    const [first, second] = indexes;
    plans[first].linkedInviteToken = plans[second].inviteToken;
    plans[second].linkedInviteToken = plans[first].inviteToken;
  }

  return plans;
}

function parseSerializedInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = parseInt(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function buildBulkPendingInviteMetadata<T extends BulkInvitationPlanningMember>(
  member: T,
  linkedInviteToken: string | null,
): {
  validChildren: T["children"];
  metadata: BulkPendingInviteMetadata | null;
} {
  const validChildren = member.children.filter((child) => child.name.trim()) as T["children"];
  if (validChildren.length === 0) return { validChildren, metadata: null };

  const children = validChildren.map((child) => ({
    name: child.name.trim(),
    yearOfBirth: parseSerializedInteger(child.yearOfBirth),
    jerseyNumber: parseSerializedInteger(child.jerseyNumber),
    existingChildId: child.existingChildId || null,
  }));
  const namedSecondGuardian = member.secondParentName?.trim() && member.secondParentEmail?.trim()
    ? {
      second_guardian_name: member.secondParentName.trim(),
      second_guardian_email: member.secondParentEmail.trim().toLowerCase(),
    }
    : null;
  const selectedSecondGuardian = member.selectedSecondParent
    ? {
      second_guardian_user_id: member.selectedSecondParent.id,
      second_guardian_name: member.selectedSecondParent.display_name,
    }
    : null;

  return {
    validChildren,
    metadata: {
      children,
      ...(linkedInviteToken ? { linked_invite_token: linkedInviteToken } : {}),
      ...(namedSecondGuardian ?? selectedSecondGuardian ?? {}),
    },
  };
}
