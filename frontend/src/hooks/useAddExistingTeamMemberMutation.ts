import { useMutation } from "@tanstack/react-query";
import type { BulkChild } from "@/components/members/ChildAndSecondGuardianFields";
import {
  ensureSecondParent,
  secondParentPartialFailureMessage,
  SecondParentError,
  type SecondParentResult,
} from "@/features/membership/secondParentInvite";
import { refreshTeamRoleChange } from "@/lab/teamMembershipCacheCompletion";
import { isDuplicateChildError } from "@/lib/childDedup";
import { friendlyMutationError } from "@/lib/friendlyMutationError";

type Profile = {
  id: string;
  display_name: string | null;
};

type UseAddExistingTeamMemberMutationArgs = {
  supabase: any;
  queryClient: any;
  userId: string | undefined;
  teamId: string;
  teamName: string;
  clubId: string;
  selectedUser: Profile | null;
  selectedRole: string;
  selectedRoleLabel: string;
  singleChildren: BulkChild[];
  clubChildren: any[];
  selectedSecondParent: Profile | null;
  secondParentName: string;
  secondParentEmail: string;
  clubBranding: any;
  discoverEmailStyle: boolean;
  customEmail: string;
  customMessage: string;
  isDuplicateError: (error: any) => boolean;
  toast: (options: any) => void;
  toastInviteSuccess: (options: any) => Promise<void>;
  onComplete: () => void;
};

export function useAddExistingTeamMemberMutation({
  supabase,
  queryClient,
  userId,
  teamId,
  teamName,
  clubId,
  selectedUser,
  selectedRole,
  selectedRoleLabel,
  singleChildren,
  clubChildren,
  selectedSecondParent,
  secondParentName,
  secondParentEmail,
  clubBranding,
  discoverEmailStyle,
  customEmail,
  customMessage,
  isDuplicateError,
  toast,
  toastInviteSuccess,
  onComplete,
}: UseAddExistingTeamMemberMutationArgs) {
  return useMutation({
    mutationFn: async () => {
      if (!selectedUser) throw new Error("No user selected");
      if (!userId) throw new Error("You must be signed in to add a member");

      const { error } = await supabase.from("user_roles").insert({
        user_id: selectedUser.id,
        team_id: teamId,
        club_id: clubId,
        role: selectedRole,
      });

      const roleWasDuplicate = error && isDuplicateError(error);
      if (error && !roleWasDuplicate) throw error;

      const createdChildIds: string[] = [];
      const resolvedChildren: { id: string; name: string; yearOfBirth: number | null }[] = [];
      if (selectedRole === "parent") {
        const validChildren = singleChildren.filter((child) => child.name.trim());
        for (const child of validChildren) {
          let childId = child.existingChildId;
          if (child.pendingInviteId) continue;

          if (childId) {
            const existingChild = clubChildren.find((candidate) => candidate.id === childId);
            if (existingChild && existingChild.parent_id !== selectedUser.id) {
              const { error: guardianError } = await supabase
                .from("child_guardians")
                .insert({ child_id: childId, guardian_id: selectedUser.id });
              if (guardianError && !isDuplicateChildError(guardianError)) {
                console.error("[AddTeamMember] Failed to link guardian:", guardianError.message);
                throw guardianError;
              }
            }
          } else {
            const { data: newChildId, error: childError } = await supabase.rpc(
              "create_child_for_parent_on_team",
              {
                p_parent_user_id: selectedUser.id,
                p_team_id: teamId,
                p_name: child.name.trim(),
                p_year_of_birth: child.yearOfBirth ? parseInt(child.yearOfBirth) : null,
              },
            );
            if (childError) {
              console.error(
                "Failed to create child:",
                childError.message,
                childError.code,
                childError.details,
                childError.hint,
                JSON.stringify(childError),
              );
              throw new Error(`We couldn't save ${child.name.trim()}. ${childError.message}`);
            }
            childId = newChildId;
          }

          if (!childId) continue;
          createdChildIds.push(childId);
          const existingClubChild = clubChildren.find((candidate) => candidate.id === childId);
          resolvedChildren.push({
            id: childId,
            name: child.name.trim(),
            yearOfBirth:
              existingClubChild?.year_of_birth ??
              (child.yearOfBirth ? parseInt(child.yearOfBirth) : null),
          });

          const { data: existing } = await supabase
            .from("child_team_assignments")
            .select("id")
            .eq("child_id", childId)
            .eq("team_id", teamId)
            .maybeSingle();
          if (!existing) {
            const { error: assignError } = await supabase
              .from("child_team_assignments")
              .insert({ child_id: childId, team_id: teamId });
            if (assignError) {
              console.error("Failed to assign child to team:", assignError.message);
              throw new Error(
                `We saved ${child.name.trim()}, but couldn't add them to ${teamName}. Please try again.`,
              );
            }
          }

          if (child.jerseyNumber) {
            const jerseyNumber = parseInt(child.jerseyNumber);
            if (!Number.isNaN(jerseyNumber)) {
              const { data: existingPosition } = await supabase
                .from("team_player_positions")
                .select("id")
                .eq("team_id", teamId)
                .eq("child_id", childId)
                .maybeSingle();
              if (existingPosition) {
                await supabase
                  .from("team_player_positions")
                  .update({ jersey_number: jerseyNumber })
                  .eq("id", existingPosition.id);
              } else {
                await supabase.from("team_player_positions").insert({
                  team_id: teamId,
                  child_id: childId,
                  position: "MID",
                  jersey_number: jerseyNumber,
                });
              }
            }
          }
        }
      }

      let secondParent: SecondParentResult = { status: "skipped", label: null };
      let secondParentFailure: string | null = null;
      try {
        secondParent = await ensureSecondParent({
          role: selectedRole,
          selectedProfile: selectedSecondParent,
          name: secondParentName,
          email: secondParentEmail,
          teamId,
          clubId,
          teamName,
          childIds: createdChildIds,
          childrenMetadata: resolvedChildren.map((child) => ({
            name: child.name,
            yearOfBirth: child.yearOfBirth,
            existingChildId: child.id,
          })),
          expectChildren:
            selectedRole === "parent" && singleChildren.some((child) => child.name.trim()),
          invitedByUserId: userId,
        });
      } catch (error) {
        console.error("[AddTeamMember] second parent failed", (error as Error)?.message);
        secondParentFailure =
          error instanceof SecondParentError
            ? error.label ?? "the second parent"
            : "the second parent";
      }

      const { error: notificationError } = await supabase.from("notifications").insert({
        user_id: selectedUser.id,
        type: "membership",
        message: `You have been added to ${teamName} as ${selectedRoleLabel}`,
        related_id: teamId,
      });

      return {
        secondParentInviteLink: secondParent.inviteLink ?? null,
        secondParentAddedDirectly: secondParent.status === "added",
        secondParentStatus: secondParent.status,
        secondParentLabel: secondParent.label,
        secondParentInviteEmail: secondParent.email ?? null,
        secondParentFailure,
        roleWasDuplicate,
        notificationFailed: !!notificationError,
        notificationError: notificationError?.message ?? null,
      };
    },
    onSuccess: async (result) => {
      refreshTeamRoleChange(queryClient, teamId);
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, null] });

      if (result.notificationFailed) {
        toast({
          variant: "destructive",
          title: "Member added — notification failed",
          description: `${selectedUser?.display_name} was added to ${teamName}, but we couldn't notify them in the app. Please tell them manually.${result.notificationError ? ` (${result.notificationError})` : ""}`,
        });
      } else if (result.roleWasDuplicate) {
        void toastInviteSuccess({
          title: "Already a member",
          description: `${selectedUser?.display_name} is already a ${selectedRoleLabel} on this team. Any new children have been linked.`,
        });
      } else {
        void toastInviteSuccess({
          title: "Member added",
          description: `${selectedUser?.display_name} has been added to the team`,
        });
      }

      if (result.secondParentFailure) {
        toast({
          variant: "destructive",
          title: "Second parent not invited",
          description: secondParentPartialFailureMessage(
            `${selectedUser?.display_name || "The member"}${singleChildren.some((child) => child.name.trim()) ? ` and ${singleChildren.filter((child) => child.name.trim()).map((child) => child.name.trim()).join(", ")}` : ""} were added`,
            result.secondParentFailure,
          ),
        });
      } else if (result.secondParentStatus === "added") {
        toast({
          title: "Second parent added",
          description: `${result.secondParentLabel} has also been added as Parent`,
        });
      } else if (result.secondParentStatus === "invited") {
        toast({
          title: "Second parent invited",
          description: `An invitation was created for ${result.secondParentLabel}.`,
        });
      }

      const childrenNames = singleChildren
        .filter((child) => child.name.trim())
        .map((child) => child.name.trim());
      if (selectedRole === "parent" && selectedUser && childrenNames.length > 0) {
        try {
          await supabase.functions.invoke("send-email", {
            body: {
              toUserId: selectedUser.id,
              subject:
                childrenNames.length === 1
                  ? discoverEmailStyle
                    ? `${clubBranding?.name || "Your club"}: See which team ${childrenNames[0]} is in ⚽`
                    : `${clubBranding?.name || "Your club"}: ${childrenNames[0]} has been added to their team ⚽`
                  : `${clubBranding?.name || "Your club"}: Your children have been added to ${teamName} ⚽`,
              template: "team-invite",
              senderName: clubBranding?.name || undefined,
              replyTo: clubBranding?.contact_email || undefined,
              templateData: {
                recipientName: selectedUser.display_name || "Parent",
                childrenNames,
                teamName,
                clubName: clubBranding?.name || "The Club",
                roleName: "Parent",
                clubLogoUrl: clubBranding?.logo_url || undefined,
                customMessage: customMessage.trim() || undefined,
                inviteLink: `${window.location.origin}/teams/${teamId}`,
              },
            },
          });
        } catch (error) {
          console.error("[AddMember] Failed to send team-invite email to primary parent:", error);
        }
      }

      if (selectedRole !== "parent" && selectedUser && !result.roleWasDuplicate) {
        const emailTarget = customEmail.trim().toLowerCase();
        try {
          await supabase.functions.invoke("send-email", {
            body: {
              ...(emailTarget ? { to: emailTarget } : { toUserId: selectedUser.id }),
              subject: `${clubBranding?.name || "Your club"}: You've been added to ${teamName} as ${selectedRoleLabel}`,
              template: "team-invite",
              senderName: clubBranding?.name || undefined,
              replyTo: clubBranding?.contact_email || undefined,
              templateData: {
                recipientName: selectedUser.display_name || selectedRoleLabel,
                teamName,
                clubName: clubBranding?.name || "The Club",
                roleName: selectedRoleLabel,
                clubLogoUrl: clubBranding?.logo_url || undefined,
                customMessage: customMessage.trim() || undefined,
                inviteLink: `${window.location.origin}/teams/${teamId}`,
              },
            },
          });
        } catch (error) {
          console.error(
            `[AddMember] Failed to send team-invite email to ${selectedRoleLabel}:`,
            error,
          );
        }
      }

      if (result.secondParentAddedDirectly && selectedSecondParent && childrenNames.length > 0) {
        try {
          await supabase.functions.invoke("send-email", {
            body: {
              toUserId: selectedSecondParent.id,
              subject:
                childrenNames.length === 1
                  ? discoverEmailStyle
                    ? `${clubBranding?.name || "Your club"}: See which team ${childrenNames[0]} is in ⚽`
                    : `${clubBranding?.name || "Your club"}: ${childrenNames[0]} has been added to their team ⚽`
                  : `${clubBranding?.name || "Your club"}: Your children have been added to ${teamName} ⚽`,
              template: "team-invite",
              senderName: clubBranding?.name || undefined,
              replyTo: clubBranding?.contact_email || undefined,
              templateData: {
                recipientName: selectedSecondParent.display_name || "Parent",
                childrenNames,
                teamName,
                clubName: clubBranding?.name || "The Club",
                roleName: "Parent",
                clubLogoUrl: clubBranding?.logo_url || undefined,
                inviteLink: `${window.location.origin}/teams/${teamId}`,
              },
            },
          });
        } catch (error) {
          console.error("[AddMember] Failed to send team-invite email to second parent:", error);
        }
      }

      if (
        result.secondParentStatus === "invited" &&
        result.secondParentInviteLink &&
        result.secondParentInviteEmail
      ) {
        try {
          const { data: emailResult, error: functionError } = await supabase.functions.invoke(
            "send-email",
            {
              body: {
                to: result.secondParentInviteEmail,
                subject:
                  childrenNames.length === 1
                    ? discoverEmailStyle
                      ? `${clubBranding?.name || "Your club"}: See which team ${childrenNames[0]} is in ⚽`
                      : `${clubBranding?.name || "Your club"}: ${childrenNames[0]} has been added to their team ⚽`
                    : `${clubBranding?.name || "Your club"}: You've been added to the team ⚽`,
                template: "team-invite",
                senderName: clubBranding?.name || undefined,
                replyTo: clubBranding?.contact_email || undefined,
                templateData: {
                  recipientName: result.secondParentLabel || "Parent",
                  invitedEmail: result.secondParentInviteEmail,
                  teamName,
                  clubName: clubBranding?.name || "The Club",
                  roleName: "Parent",
                  inviteLink: result.secondParentInviteLink,
                  clubLogoUrl: clubBranding?.logo_url || undefined,
                  childrenNames: childrenNames.length > 0 ? childrenNames : undefined,
                  customMessage: customMessage.trim() || undefined,
                },
              },
            },
          );
          const emailSent =
            !functionError && emailResult?.verified && emailResult?.success;
          const secondToken = result.secondParentInviteLink.split("/join/p/")[1];
          await supabase
            .from("pending_invites")
            .update({
              email_sent_at: emailSent ? new Date().toISOString() : null,
              email_id: emailResult?.emailId || null,
              email_error: !emailSent
                ? emailResult?.error || "Email not verified"
                : null,
            })
            .eq("invite_token", secondToken);
          toast(
            emailSent
              ? {
                  title: "Second parent invited!",
                  description: `Email sent to ${result.secondParentInviteEmail}`,
                }
              : {
                  variant: "destructive",
                  title: "Second parent invite created — email failed",
                  description: `${result.secondParentLabel}'s invitation exists but the email couldn't be sent. Share the invite link or retry.`,
                },
          );
        } catch (error) {
          console.error("Failed to send second parent email:", error);
        }
        queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      }

      if (!result.secondParentFailure) onComplete();
    },
    onError: (error: Error) => {
      toast(
        friendlyMutationError(error, {
          title: "Failed to add member",
          description: error.message || "Something went wrong. Please try again.",
        }),
      );
    },
  });
}
