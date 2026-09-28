import { useMutation } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import type { BulkChild } from "@/components/members/ChildAndSecondGuardianFields";
import {
  ensureSecondParent,
  secondParentPartialFailureMessage,
  SecondParentError,
  type SecondParentResult,
} from "@/features/membership/secondParentInvite";
import { refreshTeamRoleChange } from "@/lab/teamMembershipCacheCompletion";
import { friendlyMutationError } from "@/lib/friendlyMutationError";

type Args = {
  supabase: any;
  queryClient: any;
  user: { id: string } | null;
  teamId: string;
  teamName: string;
  clubId: string;
  nameInput: string;
  customEmail: string;
  selectedRole: string;
  roleOptions: Array<{ value: string; label: string }>;
  singleChildren: BulkChild[];
  selectedSecondParent: { id: string; display_name: string | null } | null;
  secondParentName: string;
  secondParentEmail: string;
  clubBranding: any;
  discoverEmailStyle: boolean;
  customMessage: string;
  createPendingInviteToken: () => string;
  isDuplicateError: (error: any) => boolean;
  toast: (options: any) => void;
  toastInviteSuccess: (options: any) => Promise<void>;
  setInviteLink: Dispatch<SetStateAction<string | null>>;
  setInviteShareLink: Dispatch<SetStateAction<string | null>>;
  setInviteSent: Dispatch<SetStateAction<boolean>>;
  setNameInput: Dispatch<SetStateAction<string>>;
  setCustomEmail: Dispatch<SetStateAction<string>>;
  setIsSendingNotification: Dispatch<SetStateAction<boolean>>;
};

export function useAddPendingTeamMemberMutation({
  supabase,
  queryClient,
  user,
  teamId,
  teamName,
  clubId,
  nameInput,
  customEmail,
  selectedRole,
  roleOptions,
  singleChildren,
  selectedSecondParent,
  secondParentName,
  secondParentEmail,
  clubBranding,
  discoverEmailStyle,
  customMessage,
  createPendingInviteToken,
  isDuplicateError,
  toast,
  toastInviteSuccess,
  setInviteLink,
  setInviteShareLink,
  setInviteSent,
  setNameInput,
  setCustomEmail,
  setIsSendingNotification,
}: Args) {
  return useMutation({
    mutationFn: async () => {
      if (!nameInput.trim()) throw new Error("Please enter a name");

      // Email dedupe: if the inviter typed an email and it belongs to an
      // existing in-scope user, attach the role directly instead of
      // creating a duplicate pending invite. Outside-scope emails fall
      // through to the normal invite flow (auth-side email uniqueness
      // handles dedupe at acceptance time).
      const dedupeEmail = customEmail.trim().toLowerCase();
      if (dedupeEmail) {
        const { lookupInvitableUserByEmail } =
          await import("@/lib/inviteEmailDedupe");
        const match = await lookupInvitableUserByEmail({
          email: dedupeEmail,
          clubId,
          teamId,
        });
        if (match?.already_in_team && selectedRole !== "parent") {
          throw new Error(
            `${match.display_name || dedupeEmail} is already on this team.`,
          );
        }

        if (match) {
          // Existing user the caller can see — add role directly, no email invite.
          const { error: roleErr } = await supabase.from("user_roles").insert({
            user_id: match.user_id,
            team_id: teamId,
            club_id: clubId,
            role: selectedRole as any,
          });
          if (roleErr && !isDuplicateError(roleErr)) {
            throw roleErr;
          }
          const { error: notifyErr } = await supabase
            .from("notifications")
            .insert({
              user_id: match.user_id,
              type: "membership",
              message: `You have been added to ${teamName} as ${roleOptions.find((r) => r.value === selectedRole)?.label || selectedRole}`,
              related_id: teamId,
            });
          // Second parent still goes through the shared helper so it can never
          // be silently dropped on this branch either.
          let dedupeSecondParent: SecondParentResult = {
            status: "skipped",
            label: null,
          };
          let dedupeSecondParentFailure: string | null = null;
          try {
            dedupeSecondParent = await ensureSecondParent({
              role: selectedRole,
              selectedProfile: selectedSecondParent,
              name: secondParentName,
              email: secondParentEmail,
              teamId,
              clubId,
              teamName,
              childrenMetadata: singleChildren
                .filter((c) => c.name.trim())
                .map((c) => ({
                  name: c.name.trim(),
                  yearOfBirth: c.yearOfBirth ? parseInt(c.yearOfBirth) : null,
                  existingChildId: c.existingChildId || null,
                })),
              expectChildren:
                selectedRole === "parent" &&
                singleChildren.some((c) => c.name.trim()),
              invitedByUserId: user!.id,
            });
          } catch (err) {
            console.error(
              "[AddTeamMember] second parent failed",
              (err as Error)?.message,
            );
            dedupeSecondParentFailure =
              err instanceof SecondParentError
                ? (err.label ?? "the second parent")
                : "the second parent";
          }
          return {
            link: "",
            shareLink: "",
            email: "",
            childrenCount: 0,
            childrenNames: [] as string[],
            secondParentLink: dedupeSecondParent.inviteLink ?? null,
            secondParentEmail: dedupeSecondParent.email ?? "",
            secondParentName: dedupeSecondParent.label ?? "",
            secondParentAddedDirectly: dedupeSecondParent.status === "added",
            secondParentStatus: dedupeSecondParent.status,
            secondParentLabel: dedupeSecondParent.label,
            secondParentFailure: dedupeSecondParentFailure,
            existingUserAdded: {
              name: match.display_name || dedupeEmail,
              notificationFailed: !!notifyErr,
              notificationError: notifyErr?.message ?? null,
            },
          };
        }
      }

      // Create a unique token for this specific pending invite (name-restricted)
      const inviteToken = createPendingInviteToken();

      // Build metadata for children (for parent role)
      const validChildren =
        selectedRole === "parent"
          ? singleChildren.filter((c) => c.name.trim())
          : [];
      const childrenMetadata =
        validChildren.length > 0
          ? JSON.stringify(
              validChildren.map((c) => ({
                name: c.name.trim(),
                yearOfBirth: c.yearOfBirth ? parseInt(c.yearOfBirth) : null,
                existingChildId: c.existingChildId || null,
              })),
            )
          : null;

      // Create primary invite. The second parent always gets its OWN invite row
      // (created below via the shared helper) linked back with linked_invite_token.
      const { data: primaryInvite, error: inviteError } = await supabase
        .from("pending_invites")
        .insert({
          team_id: teamId,
          club_id: clubId,
          role: selectedRole as any,
          invited_user_id: null,
          invited_by_user_id: user!.id,
          invited_label: nameInput.trim(),
          invited_email: customEmail.trim().toLowerCase() || null,
          invite_token: inviteToken,
          metadata: childrenMetadata
            ? {
                children: JSON.parse(childrenMetadata),
                ...(selectedSecondParent
                  ? { second_parent_user_id: selectedSecondParent.id }
                  : {}),
              }
            : null,
        } as any)
        .select("id, invite_token, short_code")
        .single();
      if (inviteError) throw inviteError;
      if (!primaryInvite?.id || !(primaryInvite as any)?.invite_token) {
        throw new Error(
          "The invitation could not be created. Please try again.",
        );
      }

      const link = `${window.location.origin}/join/p/${inviteToken}`;

      // Handle second parent through the one shared helper.
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
          childrenMetadata: validChildren.map((c) => ({
            name: c.name.trim(),
            yearOfBirth: c.yearOfBirth ? parseInt(c.yearOfBirth) : null,
            existingChildId: c.existingChildId || null,
          })),
          childIds: validChildren
            .map((c) => c.existingChildId)
            .filter(Boolean) as string[],
          expectChildren: validChildren.length > 0,
          invitedByUserId: user!.id,
          linkedInviteToken: inviteToken,
        });
      } catch (err) {
        console.error(
          "[AddTeamMember] second parent failed",
          (err as Error)?.message,
        );
        secondParentFailure =
          err instanceof SecondParentError
            ? (err.label ?? "the second parent")
            : "the second parent";
      }

      const shortCode = (primaryInvite as any)?.short_code || null;
      const sLink = shortCode ? `https://reference.invalid` : link;

      return {
        link,
        shareLink: sLink,
        email: customEmail.trim(),
        childrenCount: validChildren.length,
        childrenNames: validChildren.map((c) => c.name.trim()),
        secondParentLink: secondParent.inviteLink ?? null,
        secondParentEmail: secondParent.email ?? "",
        secondParentName: secondParent.label ?? "",
        secondParentAddedDirectly: secondParent.status === "added",
        secondParentStatus: secondParent.status,
        secondParentLabel: secondParent.label,
        secondParentFailure,
      };
    },
    onSuccess: async (result) => {
      const {
        link,
        shareLink: sLink,
        email,
        childrenCount,
        childrenNames,
        secondParentLink,
        secondParentEmail: secondEmail,
        secondParentName: secondName,
        secondParentAddedDirectly,
      } = result;
      const existingUserAdded = (result as any).existingUserAdded as
        | {
            name: string;
            notificationFailed?: boolean;
            notificationError?: string | null;
          }
        | undefined;

      const secondParentOutcomeToast = () => {
        if (result.secondParentFailure) {
          toast({
            variant: "destructive",
            title: "Second parent not invited",
            description: secondParentPartialFailureMessage(
              `${nameInput.trim() || "The member"}${childrenNames.length > 0 ? ` and ${childrenNames.join(", ")}` : ""} were added`,
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
      };

      // Short-circuit when we attached the role directly to an existing user
      if (existingUserAdded) {
        refreshTeamRoleChange(queryClient, teamId);
        queryClient.invalidateQueries({
          queryKey: ["pending-invites", teamId, null],
        });
        if (existingUserAdded.notificationFailed) {
          toast({
            variant: "destructive",
            title: "Member added — notification failed",
            description: `${existingUserAdded.name} was added to ${teamName}, but we couldn't notify them in the app. Please tell them manually.${existingUserAdded.notificationError ? ` (${existingUserAdded.notificationError})` : ""}`,
          });
        } else {
          toast({
            title: "Added to team",
            description: `${existingUserAdded.name} already has an account and has been added directly — no email invite was sent.`,
          });
        }
        secondParentOutcomeToast();
        setNameInput("");
        setCustomEmail("");
        return;
      }

      setInviteLink(link);
      setInviteShareLink(sLink);
      queryClient.invalidateQueries({
        queryKey: ["pending-invites", teamId, null],
      });

      secondParentOutcomeToast();

      // Auto-send email notification if email was provided
      if (email) {
        setIsSendingNotification(true);
        try {
          // Extract invite token from link for tracking
          const inviteToken = link.split("/join/p/")[1];

          const { data: emailResult, error: funcError } =
            await supabase.functions.invoke("send-email", {
              body: {
                to: email,
                subject:
                  childrenNames.length === 1
                    ? discoverEmailStyle
                      ? `${clubBranding?.name || "Your club"}: See which team ${childrenNames[0]} is in ⚽`
                      : `${clubBranding?.name || "Your club"}: ${childrenNames[0]} has been added to their team ⚽`
                    : childrenNames.length > 1
                      ? discoverEmailStyle
                        ? `${clubBranding?.name || "Your club"}: See which team your kids are in ⚽`
                        : `${clubBranding?.name || "Your club"}: Your children have been added to their team ⚽`
                      : `${clubBranding?.name || "Your club"}: You've been added to the team ⚽`,
                template: "team-invite",
                senderName: clubBranding?.name || undefined,
                replyTo: (clubBranding as any)?.contact_email || undefined,
                templateData: {
                  recipientName: nameInput.trim(),
                  invitedEmail: email,
                  teamName,
                  clubName: clubBranding?.name || "The Club",
                  roleName:
                    roleOptions.find((r) => r.value === selectedRole)?.label ||
                    "Member",
                  inviteLink: link,
                  clubLogoUrl: clubBranding?.logo_url || undefined,
                  childrenNames:
                    childrenNames.length > 0 ? childrenNames : undefined,
                  customMessage: customMessage.trim() || undefined,
                },
              },
            });

          // Update pending invite with email status
          const emailSent =
            !funcError && emailResult?.verified && emailResult?.success;
          const emailId = emailResult?.emailId || null;
          let functionErrorDetails: string | null = null;
          if (funcError) {
            try {
              const errorContext = (funcError as any)?.context;
              functionErrorDetails =
                errorContext && typeof errorContext.json === "function"
                  ? (await errorContext.json())?.error || null
                  : null;
            } catch {
              functionErrorDetails = null;
            }
          }
          const emailError =
            functionErrorDetails ||
            funcError?.message ||
            (!emailSent ? emailResult?.error || "Email not verified" : null);

          await supabase
            .from("pending_invites")
            .update({
              email_sent_at: emailSent ? new Date().toISOString() : null,
              email_id: emailId,
              email_error: emailError,
            } as any)
            .eq("invite_token", inviteToken);

          // Refresh the pending invites list to show updated status
          queryClient.invalidateQueries({ queryKey: ["pending-invites"] });

          if (emailSent) {
            void toastInviteSuccess({
              title: "Invite sent!",
              description: `Email notification sent to ${email}`,
            });
          } else {
            toast({
              title: "Invite created — email failed",
              description:
                emailError ||
                "The email provider did not accept the message. Share the invite link manually.",
              variant: "destructive",
            });
          }
        } catch (error) {
          console.error("Failed to send email:", error);
          void toastInviteSuccess({
            title: "Member added",
            description: "Could not send email, but invite has been created",
            variant: "default",
          });
        } finally {
          setIsSendingNotification(false);
        }
      } else {
        // No email — show share step. Do NOT auto-write to clipboard here:
        // the success step has an explicit "Copy Link" button, and clobbering
        // the clipboard wipes out anything the user just copied (e.g. a phone
        // number they intended to paste into the SMS/WhatsApp share field).
        void toastInviteSuccess({
          title: "Member added",
          description: `${nameInput} has been added. Use the share options to send the invite link.`,
        });
      }

      // Send email to second parent if provided
      if (secondEmail && secondParentLink) {
        try {
          const secondToken = secondParentLink.split("/join/p/")[1];
          const { data: emailResult, error: funcError } =
            await supabase.functions.invoke("send-email", {
              body: {
                to: secondEmail,
                subject:
                  childrenNames.length === 1
                    ? discoverEmailStyle
                      ? `${clubBranding?.name || "Your club"}: See which team ${childrenNames[0]} is in ⚽`
                      : `${clubBranding?.name || "Your club"}: ${childrenNames[0]} has been added to their team ⚽`
                    : childrenNames.length > 1
                      ? discoverEmailStyle
                        ? `${clubBranding?.name || "Your club"}: See which team your kids are in ⚽`
                        : `${clubBranding?.name || "Your club"}: Your children have been added to their team ⚽`
                      : `${clubBranding?.name || "Your club"}: You've been added to the team ⚽`,
                template: "team-invite",
                senderName: clubBranding?.name || undefined,
                replyTo: (clubBranding as any)?.contact_email || undefined,
                templateData: {
                  recipientName: secondName,
                  invitedEmail: secondEmail,
                  teamName,
                  clubName: clubBranding?.name || "The Club",
                  roleName: "Parent",
                  inviteLink: secondParentLink,
                  clubLogoUrl: clubBranding?.logo_url || undefined,
                  childrenNames:
                    childrenNames.length > 0 ? childrenNames : undefined,
                  customMessage: customMessage.trim() || undefined,
                },
              },
            });

          const emailSent =
            !funcError && emailResult?.verified && emailResult?.success;
          await supabase
            .from("pending_invites")
            .update({
              email_sent_at: emailSent ? new Date().toISOString() : null,
              email_id: emailResult?.emailId || null,
              email_error: !emailSent
                ? emailResult?.error || "Email not verified"
                : null,
            } as any)
            .eq("invite_token", secondToken);

          if (emailSent) {
            toast({
              title: "Second parent invited!",
              description: `Email also sent to ${secondEmail}`,
            });
          } else {
            toast({
              variant: "destructive",
              title: "Second parent invite created — email failed",
              description: `${secondName}'s invitation exists but the email couldn't be sent. Share the invite link or retry.`,
            });
          }
        } catch (error) {
          console.error("Failed to send second parent email:", error);
        }
        queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      }

      // Send team-invite email to second parent (existing user added directly)
      if (
        secondParentAddedDirectly &&
        selectedSecondParent &&
        childrenNames.length > 0
      ) {
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
              replyTo: (clubBranding as any)?.contact_email || undefined,
              templateData: {
                recipientName: selectedSecondParent.display_name || "Parent",
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
        } catch (err) {
          console.error(
            "[AddMember] Failed to send team-invite email to second parent (new flow):",
            err,
          );
        }
      }
    },
    onError: (error: Error) => {
      toast(
        friendlyMutationError(error, {
          title: "Failed to add member",
          description:
            error.message || "Something went wrong. Please try again.",
        }),
      );
    },
  });
}
