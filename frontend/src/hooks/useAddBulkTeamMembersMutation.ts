import { useMutation } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import type { BulkChild } from "@/components/members/ChildAndSecondGuardianFields";
import type { BulkMemberResult } from "@/components/members/AddTeamMemberSuccessSheets";
import { ensureSecondParent, secondParentPartialFailureMessage, SecondParentError } from "@/features/membership/secondParentInvite";
import { refreshTeamRoleChange } from "@/lab/teamMembershipCacheCompletion";
import { isDuplicateChildError } from "@/lib/childDedup";
import { friendlyMutationError } from "@/lib/friendlyMutationError";

type TeamRole = "player" | "parent" | "coach" | "team_admin";

type BulkMember = {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  children: BulkChild[];
  selectedUser?: { id: string; display_name: string | null; avatar_url: string | null } | null;
  secondParentName?: string;
  secondParentEmail?: string;
  secondParentSearch?: string;
  selectedSecondParent?: { id: string; display_name: string | null; avatar_url: string | null } | null;
};

type Args = {
  supabase: any;
  queryClient: any;
  user: { id: string } | null;
  teamId: string;
  teamName: string;
  clubId: string;
  bulkMembers: BulkMember[];
  clubChildren: any[];
  clubBranding: any;
  discoverEmailStyle: boolean;
  customMessage: string;
  roleOptions: Array<{ value: string; label: string }>;
  isDuplicateError: (error: any) => boolean;
  toast: (options: any) => void;
  toastInviteSuccess: (options: any) => Promise<void>;
  setBulkResults: Dispatch<SetStateAction<BulkMemberResult[]>>;
};

export function useAddBulkTeamMembersMutation({
  supabase, queryClient, user, teamId, teamName, clubId, bulkMembers, clubChildren,
  clubBranding, discoverEmailStyle, customMessage, roleOptions, isDuplicateError,
  toast, toastInviteSuccess, setBulkResults,
}: Args) {
  return useMutation({
    mutationFn: async (membersToAdd?: BulkMember[]) => {
      const membersSource = membersToAdd || bulkMembers;
      const validMembers = membersSource.filter(m => m.name.trim());
      if (validMembers.length === 0) throw new Error("Please enter at least one name");

      const results: { name: string; email: string; link: string; sent: boolean; role: string; childrenCount: number }[] = [];
      const secondParentFailures: string[] = [];
      const secondParentInvited: string[] = [];
      const secondParentAdded: string[] = [];

      /**
       * Single second-parent path for BOTH bulk branches. Always creates a real
       * invite row (or attaches an existing profile), never swallows an error,
       * and records the outcome so the summary toast can report it.
       */
      const handleSecondParent = async (
        member: BulkMember,
        validChildren: BulkMember["children"],
        childIds: string[],
        linkedInviteToken: string | null,
      ) => {
        try {
          const res = await ensureSecondParent({
            role: member.role,
            selectedProfile: member.selectedSecondParent ?? null,
            name: member.secondParentName,
            email: member.secondParentEmail,
            teamId,
            clubId,
            teamName,
            childIds,
            childrenMetadata: validChildren
              .filter((c) => c.name.trim())
              .map((c) => ({
                name: c.name.trim(),
                yearOfBirth: c.yearOfBirth ? parseInt(c.yearOfBirth) : null,
                existingChildId: c.existingChildId || null,
              })),
            expectChildren: validChildren.filter((c) => c.name.trim()).length > 0,
            invitedByUserId: user!.id,
            linkedInviteToken,
          });

          if (res.status === "added" && res.label) {
            secondParentAdded.push(res.label);
          } else if (res.status === "invited" && res.email && res.inviteLink) {
            secondParentInvited.push(res.label || res.email);
            try {
              const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
                body: {
                  to: res.email,
                  subject: `${clubBranding?.name || 'Your club'}: You've been invited as a guardian ⚽`,
                  template: "team-invite",
                  senderName: clubBranding?.name || undefined,
                  replyTo: (clubBranding as any)?.contact_email || undefined,
                  templateData: {
                    recipientName: res.label || "Parent",
                    invitedEmail: res.email,
                    teamName,
                    clubName: clubBranding?.name || "The Club",
                    roleName: "Parent",
                    inviteLink: res.inviteLink,
                    clubLogoUrl: clubBranding?.logo_url || undefined,
                    childrenNames: validChildren.filter(c => c.name.trim()).map(c => c.name.trim()),
                  },
                },
              });
              const emailSent = !funcError && emailResult?.verified && emailResult?.success;
              await supabase
                .from("pending_invites")
                .update({
                  email_sent_at: emailSent ? new Date().toISOString() : null,
                  email_id: emailResult?.emailId || null,
                  email_error: !emailSent ? (emailResult?.error || "Email not verified") : null,
                } as any)
                .eq("invite_token", res.inviteToken!);
            } catch (err) {
              console.error("[BulkAdd] second guardian email failed", (err as Error)?.message);
            }
          }
        } catch (err) {
          console.error("[BulkAdd] second parent failed", (err as Error)?.message);
          secondParentFailures.push(
            err instanceof SecondParentError ? (err.label ?? "a second parent") : "a second parent",
          );
        }
      };


      // Pre-generate tokens for all members so we can cross-link parent pairs
      const memberTokens = validMembers.map(() => crypto.randomUUID());

      // Detect parent pairs sharing the same children (by matching children names)
      // Build a map: children fingerprint -> list of member indices
      const childFingerprints = new Map<string, number[]>();
      validMembers.forEach((member, idx) => {
        if (member.role === "parent" && member.children.some(c => c.name.trim())) {
          const fingerprint = member.children
            .filter(c => c.name.trim())
            .map(c => c.name.trim().toLowerCase())
            .sort()
            .join("|");
          if (fingerprint) {
            const existing = childFingerprints.get(fingerprint) || [];
            existing.push(idx);
            childFingerprints.set(fingerprint, existing);
          }
        }
      });

      // Build cross-link map: memberIndex -> linkedMemberToken
      const crossLinks = new Map<number, string>();
      for (const indices of childFingerprints.values()) {
        if (indices.length === 2) {
          crossLinks.set(indices[0], memberTokens[indices[1]]);
          crossLinks.set(indices[1], memberTokens[indices[0]]);
        }
      }

      for (let i = 0; i < validMembers.length; i++) {
        const member = validMembers[i];
        const inviteToken = memberTokens[i];
        const memberRole = member.role;

        // Build metadata for children (for parent role)
        const validChildren = member.children.filter(c => c.name.trim());
        const childrenMetadata = validChildren.length > 0 ? JSON.stringify(
          validChildren.map(c => ({
            name: c.name.trim(),
            yearOfBirth: c.yearOfBirth ? parseInt(c.yearOfBirth) : null,
            jerseyNumber: c.jerseyNumber ? parseInt(c.jerseyNumber) : null,
            existingChildId: c.existingChildId || null,
          }))
        ) : null;

        if (member.selectedUser) {
          const { error: roleError } = await supabase.from("user_roles").insert({
            user_id: member.selectedUser.id,
            team_id: teamId,
            club_id: clubId,
            role: memberRole,
          });

          if (roleError && !isDuplicateError(roleError)) {
            console.error("Failed to add existing bulk member", member.name, roleError);
            continue;
          }

          for (const child of validChildren) {
            let childId = child.existingChildId;

            // Skip children linked to pending invites
            if (child.pendingInviteId) continue;

            if (memberRole === "parent") {
              if (childId) {
                const existingChild = clubChildren.find(c => c.id === childId);
                if (existingChild && existingChild.parent_id !== member.selectedUser.id) {
                  const { error: guardianError } = await supabase
                    .from("child_guardians")
                    .insert({ child_id: childId, guardian_id: member.selectedUser.id });
                  if (guardianError && !isDuplicateChildError(guardianError)) {
                    console.error("[AddTeamMember] Failed to link guardian:", guardianError.message);
                    throw guardianError;
                  }
                }
              } else {
                const { data: newChildId, error: childError } = await supabase.rpc(
                  "create_child_for_parent_on_team",
                  {
                    p_parent_user_id: member.selectedUser.id,
                    p_team_id: teamId,
                    p_name: child.name.trim(),
                    p_year_of_birth: child.yearOfBirth ? parseInt(child.yearOfBirth) : null,
                  }
                );

                if (childError) {
                  console.error("Failed to create bulk child:", childError);
                  continue;
                }
                childId = newChildId;
              }

              if (childId) {
                const { data: existingAssignment } = await supabase
                  .from("child_team_assignments")
                  .select("id")
                  .eq("child_id", childId)
                  .eq("team_id", teamId)
                  .maybeSingle();

                if (!existingAssignment) {
                  await supabase.from("child_team_assignments").insert({
                    child_id: childId,
                    team_id: teamId,
                  });
                }
              }
            }
          }

          // Second guardian: one shared path, errors surfaced (never swallowed).
          await handleSecondParent(
            member,
            validChildren,
            validChildren.map((c) => c.existingChildId).filter(Boolean) as string[],
            null,
          );


          await supabase.from("notifications").insert({
            user_id: member.selectedUser.id,
            type: "membership",
            message: `You have been added to ${teamName} as ${roleOptions.find(r => r.value === memberRole)?.label}`,
            related_id: teamId,
          });

          results.push({
            name: member.selectedUser.display_name || member.name.trim(),
            email: member.email.trim(),
            link: `${window.location.origin}/teams/${teamId}`,
            sent: true,
            role: memberRole,
            childrenCount: validChildren.length,
          });
          continue;
        }

        // Add linked_invite_token if this parent is paired with another
        const linkedToken = crossLinks.get(i);
        const metadata = childrenMetadata
          ? {
              children: JSON.parse(childrenMetadata),
              ...(linkedToken ? { linked_invite_token: linkedToken } : {}),
              ...(member.selectedSecondParent
                ? { second_parent_user_id: member.selectedSecondParent.id }
                : {}),
            }
          : null;

        // Create pending invite record with children metadata
        const { error: inviteError } = await supabase.from("pending_invites").insert({
          team_id: teamId,
          club_id: clubId,
          role: memberRole as any,
          invited_user_id: null,
          invited_by_user_id: user!.id,
          invited_label: member.name.trim(),
          invited_email: member.email.trim().toLowerCase() || null,
          invite_token: inviteToken,
          metadata,
        } as any);

        if (inviteError) {
          console.error("Failed to create invite for", member.name, inviteError);
          continue;
        }

        // Second parent gets its OWN invite row (previously this path only wrote
        // inert second_guardian_* metadata that nothing consumed).
        await handleSecondParent(member, validChildren, [], inviteToken);


        const link = `${window.location.origin}/join/p/${inviteToken}`;
        let sent = false;

        // Send email if provided - with verification and tracking
        let emailId: string | null = null;
        let emailError: string | null = null;

        if (member.email.trim()) {
          try {
            const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
              body: {
                to: member.email.trim(),
                 subject: validChildren.length === 1
                   ? (discoverEmailStyle
                       ? `${clubBranding?.name || 'Your club'}: See which team ${validChildren[0].name.trim()} is in ⚽`
                       : `${clubBranding?.name || 'Your club'}: ${validChildren[0].name.trim()} has been added to their team ⚽`)
                   : validChildren.length > 1
                     ? (discoverEmailStyle
                         ? `${clubBranding?.name || 'Your club'}: See which team your kids are in ⚽`
                         : `${clubBranding?.name || 'Your club'}: Your children have been added to their team ⚽`)
                     : `${clubBranding?.name || 'Your club'}: You've been added to the team ⚽`,
                template: "team-invite",
                senderName: clubBranding?.name || undefined,
                replyTo: (clubBranding as any)?.contact_email || undefined,
                templateData: {
                  recipientName: member.name.trim(),
                  invitedEmail: member.email.trim(),
                  teamName,
                  clubName: clubBranding?.name || "The Club",
                  roleName: roleOptions.find(r => r.value === memberRole)?.label || "Member",
                  inviteLink: link,
                  clubLogoUrl: clubBranding?.logo_url || undefined,
                  childrenNames: validChildren.map(c => c.name.trim()),
                  customMessage: customMessage.trim() || undefined,
                },
              },
            });

            // Verify email was actually sent by checking the verified flag
            if (funcError) {
              emailError = funcError.message || "Function error";
              console.error("Email function error for", member.email, funcError);
            } else if (emailResult?.verified && emailResult?.success) {
              sent = true;
              emailId = emailResult.emailId;
              console.log("Email verified sent to", member.email, "ID:", emailId);
            } else {
              emailError = emailResult?.error || "Email not verified";
              console.warn("Email not verified for", member.email, "Response:", emailResult);
            }
          } catch (error) {
            emailError = error instanceof Error ? error.message : "Unknown error";
            console.error("Failed to send email to", member.email, error);
          }

          // Update pending invite with email status
          await supabase
            .from("pending_invites")
            .update({
              email_sent_at: sent ? new Date().toISOString() : null,
              email_id: emailId,
              email_error: emailError,
            } as any)
            .eq("invite_token", inviteToken);
        }

        results.push({
          name: member.name.trim(),
          email: member.email.trim(),
          link,
          sent,
          role: memberRole,
          childrenCount: validChildren.length
        });
      }

      return { results, secondParentFailures, secondParentInvited, secondParentAdded };
    },
    onSuccess: ({ results, secondParentFailures, secondParentInvited, secondParentAdded }) => {
      setBulkResults(results);
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, null] });
      refreshTeamRoleChange(queryClient, teamId);

      const sentCount = results.filter(r => r.sent).length;
      const totalCount = results.length;

      void toastInviteSuccess({
        title: `${totalCount} member${totalCount > 1 ? "s" : ""} added`,
        description: sentCount > 0
          ? `${sentCount} member${sentCount > 1 ? "s were" : " was"} added or emailed successfully`
          : "Share the invite links with your members",
      });

      if (secondParentAdded.length > 0 || secondParentInvited.length > 0) {
        toast({
          title: "Second parents handled",
          description: [
            secondParentAdded.length > 0 ? `Added: ${secondParentAdded.join(", ")}` : null,
            secondParentInvited.length > 0 ? `Invited: ${secondParentInvited.join(", ")}` : null,
          ].filter(Boolean).join(" · "),
        });
      }
      if (secondParentFailures.length > 0) {
        toast({
          variant: "destructive",
          title: "Some second parents were not invited",
          description: secondParentPartialFailureMessage(
            "Members were added",
            secondParentFailures.join(", "),
          ),
        });
      }
    },

    onError: (error: Error) => {
      toast(
        friendlyMutationError(error, {
          title: "Failed to add members",
          description: error.message || "Something went wrong. Please try again.",
        }),
      );
    },
  });

}
