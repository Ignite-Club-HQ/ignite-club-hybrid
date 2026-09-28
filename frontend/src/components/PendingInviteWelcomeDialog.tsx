import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { useClubTheme } from "@/hooks/useClubTheme";
import { applyInviteClubSwitch } from "@/lib/inviteClubSwitch";
import { seedClubThemeFromAnyInvite } from "@/lib/inviteThemeFallback";

import { createChildForParentOrReuse, resolveCanonicalChildId } from "@/lib/childDedup";
import {
  acceptParentTeamInvite,
  isNotChildParentInviteError,
} from "@/features/membership/acceptParentInvite";
import { membershipKeys } from "@/lab/membershipQueryKeys";

/** Best-effort "child added" email for a second parent. Never blocks acceptance. */
async function notifySecondParent(
  secondParentUserId: string,
  teamId: string,
  childNames: string[]
) {
  if (childNames.length === 0) return;
  try {
    const { data: teamInfo } = await supabase
      .from("teams")
      .select("name, club_id, clubs:club_id(name, logo_url, contact_email)")
      .eq("id", teamId)
      .single();
    if (!teamInfo) return;
    const club = (teamInfo as any).clubs;
    await supabase.functions.invoke("send-email", {
      body: {
        toUserId: secondParentUserId,
        subject:
          childNames.length === 1
            ? `${club?.name || "Your club"}: See which team ${childNames[0]} is in ⚽`
            : `${club?.name || "Your club"}: Your children have been added to ${(teamInfo as any).name} ⚽`,
        template: "child-added",
        senderName: club?.name || undefined,
        replyTo: club?.contact_email || undefined,
        templateData: {
          recipientName: "Parent",
          childrenNames: childNames,
          teamName: (teamInfo as any).name,
          clubName: club?.name || "The Club",
          clubLogoUrl: club?.logo_url || undefined,
          inviteLink: `${window.location.origin}/teams/${teamId}`,
        },
      },
    });
  } catch (emailErr) {
    console.error("[InviteAutoAccept] Second-parent child-added email failed:", emailErr);
  }
}


/**
 * Silently auto-accepts any pending invites for the logged-in user.
 * No dialog is shown — invites are processed automatically in the background.
 */
export function PendingInviteWelcomeDialog() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { setActiveClubTheme } = useClubTheme();

  const { data: pendingInvites = [] } = useQuery({
    queryKey: membershipKeys.pendingInvitesForUser(user?.id),
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("pending_invites")
        .select(`
          id,
          role,
          invite_token,
          team_id,
          club_id,
          invited_label,
          metadata,
          teams:team_id (
            name,
            club_id,
            clubs:club_id (
              name
            )
          ),
          clubs:club_id (
            name
          )
        `)
        .eq("invited_user_id", user.id)
        .eq("status", "pending")
        .limit(10);

      if (error) {
        console.error("[InviteAutoAccept] Error fetching invites:", error);
        return [];
      }
      return data || [];
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  const createChildrenFromMetadata = async (
    childrenData: any[], parentId: string, teamId: string | null
  ) => {
    const createdChildIds: string[] = [];
    for (const childData of childrenData) {
      let childId = childData.existingChildId;

      if (childId) {
        // Link to existing child as guardian instead of creating duplicate
        const { error: guardErr } = await supabase.from("child_guardians").insert({
          child_id: childId,
          guardian_id: parentId,
          relationship_type: "parent",
          is_primary: false,
        });
        if (guardErr && !guardErr.message?.includes("duplicate")) {
          console.error("[InviteAutoAccept] Failed to link guardian to existing child:", guardErr.message);
        }
        // Ensure team assignment exists
        if (teamId) {
          const { data: existing } = await supabase
            .from("child_team_assignments")
            .select("id")
            .eq("child_id", childId)
            .eq("team_id", teamId)
            .maybeSingle();
          if (!existing) {
            await supabase.from("child_team_assignments").insert({
              child_id: childId,
              team_id: teamId,
            });
          }
        }
        createdChildIds.push(childId);
      } else {
        // Check if a child with the same name already exists on this team
        let existingChildOnTeam: any = null;
        if (teamId) {
          const { data: matches } = await supabase
            .from("child_team_assignments")
            .select("child_id, children!inner(id, name)")
            .eq("team_id", teamId);
          existingChildOnTeam = (matches || []).find(
            (m: any) => m.children?.name?.toLowerCase().trim() === childData.name?.toLowerCase().trim()
          );
        }

        if (existingChildOnTeam) {
          // Child already exists on team — link as guardian instead of creating duplicate
          const existingId = existingChildOnTeam.child_id;
          await supabase.from("child_guardians").insert({
            child_id: existingId,
            guardian_id: parentId,
            relationship_type: "parent",
            is_primary: false,
          }).then(({ error: guardErr }) => {
            if (guardErr && !guardErr.message?.includes("duplicate")) {
              console.error("[InviteAutoAccept] Failed to link guardian to existing child:", guardErr.message);
            }
          });
          createdChildIds.push(existingId);
        } else {
          // Create new child
          const { childId: createdChildId, error: childError } =
            await createChildForParentOrReuse(
              parentId,
              childData.name,
              childData.yearOfBirth ?? null
            );
          const newChild = createdChildId ? { id: createdChildId } : null;

          if (childError) {
            console.error("[InviteAutoAccept] Failed to create child:", childError.message);
            continue;
          }

          let effectiveChildId = newChild?.id as string | undefined;

          if (effectiveChildId && teamId) {
            await supabase.from("child_team_assignments").insert({
              child_id: effectiveChildId,
              team_id: teamId,
            });

            // The server dedupes same-name children on a team: the new row may have
            // been merged into the canonical child and removed. Re-resolve the id so
            // downstream links (e.g. second parent) attach to the surviving record.
            effectiveChildId =
              (await resolveCanonicalChildId(
                effectiveChildId,
                teamId,
                childData.name
              )) ?? undefined;
          }

          if (effectiveChildId) createdChildIds.push(effectiveChildId);

        }
      }
    }
    return createdChildIds;
  };

  useEffect(() => {
    if (!user || pendingInvites.length === 0) return;

    const autoAcceptInvites = async () => {
      let firstInvitedClubId: string | null = null;

      for (const invite of pendingInvites) {
        try {
          // Resolve club_id
          let clubId: string | null = invite.club_id ?? null;
          if (!clubId && invite.team_id) {
            clubId = (invite.teams as any)?.club_id ?? null;
          }
          if (clubId && !firstInvitedClubId) {
            firstInvitedClubId = clubId;
          }

          const parentInviteMeta = invite.metadata as any;
          const isGuardianChildInvite =
            invite.role === "parent" && !!parentInviteMeta?.guardian_child_id;

          // Guardian (parent-to-parent) invites: run the whole thing as a
          // single transactional RPC. If the guardian link fails, no role
          // is created and the invite stays pending so we can retry.
          if (isGuardianChildInvite) {
            const { data: rpcData, error: rpcError } = await supabase.rpc(
              "accept_guardian_parent_invite" as any,
              { _invite_id: invite.id }
            );
            if (rpcError) {
              console.error(
                "[InviteAutoAccept] Guardian RPC failed, leaving invite pending:",
                invite.id,
                rpcError
              );
              continue; // do NOT mark accepted, do NOT send email
            }
            console.log("[InviteAutoAccept] Guardian invite accepted via RPC:", rpcData);

            // Best-effort child-added email (external side effect, non-blocking).
            try {
              const meta = parentInviteMeta;
              const childName = meta.guardian_child_name || "your child";
              const teamIdsFromRpc: string[] = Array.isArray((rpcData as any)?.team_ids)
                ? (rpcData as any).team_ids
                : [];
              const firstTeamId =
                teamIdsFromRpc[0] ||
                (Array.isArray(meta.guardian_all_team_ids)
                  ? meta.guardian_all_team_ids[0]
                  : invite.team_id);
              if (firstTeamId) {
                const { data: teamInfo } = await supabase
                  .from("teams")
                  .select("name, club_id, clubs!club_id(name, logo_url, contact_email)")
                  .eq("id", firstTeamId)
                  .single();
                if (teamInfo) {
                  const club = (teamInfo as any).clubs;
                  await supabase.functions.invoke("send-email", {
                    body: {
                      to: null,
                      toUserId: user.id,
                      subject: `${club?.name || "Your club"}: You've been linked to ${childName}'s team ⚽`,
                      template: "child-added",
                      senderName: club?.name || undefined,
                      replyTo: club?.contact_email || undefined,
                      templateData: {
                        recipientName: user.user_metadata?.display_name || "there",
                        teamName: (teamInfo as any).name,
                        clubName: club?.name || "The Club",
                        inviteLink: `${window.location.origin}/teams/${firstTeamId}`,
                        clubLogoUrl: club?.logo_url || undefined,
                        childrenNames: [childName],
                      },
                    },
                  });
                }
              }
            } catch (emailErr) {
              console.error(
                "[InviteAutoAccept] Guardian child-added email failed (non-blocking):",
                emailErr
              );
            }
            continue; // guardian branch complete — do not fall through
          }

          // Parent invitations carrying child metadata: one atomic RPC creates
          // the children, guardian links, team assignment, the parent role and
          // marks the invite accepted. Any failure rolls everything back and
          // leaves the invite pending so the next attempt can retry.
          const hasChildMetadata =
            invite.role === "parent" &&
            Array.isArray(parentInviteMeta?.children) &&
            parentInviteMeta.children.length > 0 &&
            !(parentInviteMeta?.child_id && parentInviteMeta?.mini_league_id) &&
            !["mini_league_parent_join_link", "league_admin_join_link"].includes(
              parentInviteMeta?.kind ?? ""
            );

          if (hasChildMetadata) {
            try {
              const result = await acceptParentTeamInvite({ inviteId: invite.id });
              console.log("[InviteAutoAccept] Parent invite accepted atomically:", {
                inviteId: invite.id,
                children: result.childIds.length,
                alreadyAccepted: result.alreadyAccepted,
              });
            } catch (rpcError) {
              if (!isNotChildParentInviteError(rpcError)) {
                console.error(
                  "[InviteAutoAccept] Parent invite RPC failed, leaving invite pending:",
                  invite.id
                );
                continue; // no partial membership, no acceptance
              }
              console.warn(
                "[InviteAutoAccept] Invite not eligible for parent RPC, using legacy path:",
                invite.id
              );
            }

            if (parentInviteMeta?.second_parent_user_id && invite.team_id) {
              await notifySecondParent(
                parentInviteMeta.second_parent_user_id,
                invite.team_id,
                (parentInviteMeta.children as any[]).map((c: any) => c?.name).filter(Boolean)
              );
            }
            continue;
          }



          // Non-guardian path: check if role already exists
          const roleQuery = supabase
            .from("user_roles")
            .select("id")
            .eq("user_id", user.id)
            .eq("role", invite.role as any);

          if (invite.team_id) {
            roleQuery.eq("team_id", invite.team_id);
          } else if (clubId) {
            roleQuery.eq("club_id", clubId).is("team_id", null);
          }

          const { data: existingRole } = await roleQuery.maybeSingle();
          const needsParentLinking = invite.role === "parent" && (
            !!parentInviteMeta?.child_id ||
            Array.isArray(parentInviteMeta?.children)
          );

          if (!existingRole) {
            const { error: roleError } = await supabase
              .from("user_roles")
              .insert({
                user_id: user.id,
                role: invite.role as any,
                team_id: invite.team_id || null,
                club_id: clubId || null,
              });

            if (roleError) {
              console.error("[InviteAutoAccept] Failed to assign role:", roleError);
              continue;
            }
          } else if (!needsParentLinking) {
            await supabase
              .from("pending_invites")
              .update({ status: "accepted", accepted_at: new Date().toISOString() })
              .eq("id", invite.id);
            console.log("[InviteAutoAccept] Invite already fulfilled, marked accepted:", invite.id);
            continue;
          } else {
            console.log("[InviteAutoAccept] Role already exists, continuing with parent-link sync:", invite.id);
          }

          const entityName =
            (invite.teams as any)?.name ||
            (invite.teams as any)?.clubs?.name ||
            (invite.clubs as any)?.name ||
            "organization";

          console.log("[InviteAutoAccept] Auto-accepted invite for:", entityName, "role:", invite.role);

          // Handle guardian invite (parent-to-parent flow)
          if (invite.metadata && invite.role === "parent") {
            const meta = invite.metadata as any;

            // (guardian_child_id branch handled earlier via transactional RPC)



            // Mini-league invite: child already exists, link parent as guardian
            if (meta.child_id && meta.mini_league_id) {
              const childId = meta.child_id;
              const miniLeagueId = meta.mini_league_id;

              console.log("[InviteAutoAccept] Mini-league invite: linking parent to existing child:", childId);

              // Transfer child ownership to this parent (they are the real parent)
              await supabase
                .from("children")
                .update({ parent_id: user.id })
                .eq("id", childId);

              // Ensure mini league assignment exists
              const { data: existingLeagueAssignment } = await supabase
                .from("child_mini_league_assignments")
                .select("id")
                .eq("child_id", childId)
                .eq("mini_league_id", miniLeagueId)
                .maybeSingle();

              if (!existingLeagueAssignment) {
                await supabase.from("child_mini_league_assignments").insert({
                  child_id: childId,
                  mini_league_id: miniLeagueId,
                  ability_rating: 3,
                });
                console.log("[InviteAutoAccept] Created mini league assignment for child:", childId);
              }

              // Update mini_league_players to link parent_user_id
              if (meta.player_id) {
                await supabase
                  .from("mini_league_players")
                  .update({ parent_user_id: user.id })
                  .eq("id", meta.player_id);
              } else {
                await supabase
                  .from("mini_league_players")
                  .update({ parent_user_id: user.id })
                  .eq("child_id", childId)
                  .eq("mini_league_id", miniLeagueId);
              }

              // Send notification
              const playerName = meta.player_name || meta.children?.[0]?.name || "Your child";
              await supabase.from("notifications").insert({
                user_id: user.id,
                type: "membership",
                message: `${playerName} has been added to a league`,
                related_id: miniLeagueId,
              });

              // Send child-added email
              try {
                const { data: leagueInfo } = await supabase
                  .from("mini_leagues")
                  .select("name, club_id, clubs:club_id(name, logo_url, contact_email)")
                  .eq("id", miniLeagueId)
                  .single();

                if (leagueInfo) {
                  const club = leagueInfo.clubs as any;
                  const inviteLink = `${window.location.origin}/mini-leagues/${miniLeagueId}`;

                  await supabase.functions.invoke("send-email", {
                    body: {
                      toUserId: user.id,
                      subject: `${club?.name || 'Your club'}: ${playerName} has been added to ${leagueInfo.name} ⚽`,
                      template: "child-added",
                      senderName: club?.name || undefined,
                      replyTo: club?.contact_email || undefined,
                      templateData: {
                        recipientName: user.user_metadata?.display_name || "there",
                        teamName: leagueInfo.name,
                        clubName: club?.name || "The Club",
                        inviteLink,
                        clubLogoUrl: club?.logo_url || undefined,
                        childrenNames: [playerName],
                      },
                    },
                  });
                  console.log("[InviteAutoAccept] Sent child-added email for mini-league");
                }
              } catch (emailErr) {
                console.error("[InviteAutoAccept] Failed to send mini-league child-added email:", emailErr);
              }

              await supabase
                .from("pending_invites")
                .update({
                  status: "accepted",
                  accepted_at: new Date().toISOString(),
                  invited_user_id: user.id,
                })
                .eq("id", invite.id);

              continue; // Skip standard children flow
            }

            // Standard dual-parent invite flow with children metadata
            const linkedToken = meta.linked_invite_token;
            const childrenData = meta.children || [];

            if (linkedToken && invite.team_id && childrenData.length > 0) {
              // Check if the other parent's invite was already accepted
              const { data: otherInvite } = await supabase
                .from("pending_invites")
                .select("invited_user_id, status")
                .eq("invite_token", linkedToken)
                .maybeSingle();

              const otherAccepted = otherInvite?.status === "accepted" && otherInvite?.invited_user_id;

              if (otherAccepted) {
                // Other parent accepted first — find their children in this team and link as guardian
                const { data: existingChildren } = await supabase
                  .from("children")
                  .select("id, name, child_team_assignments!inner(team_id)")
                  .eq("parent_id", otherInvite.invited_user_id)
                  .eq("child_team_assignments.team_id", invite.team_id);

                if (existingChildren && existingChildren.length > 0) {
                  for (const child of existingChildren) {
                    await supabase.from("child_guardians").insert({
                      child_id: child.id,
                      guardian_id: user.id,
                      relationship_type: "parent",
                      is_primary: false,
                    }).then(({ error: guardErr }) => {
                      if (guardErr && !guardErr.message?.includes("duplicate")) {
                        console.error("[InviteAutoAccept] Failed to link guardian:", guardErr.message);
                      }
                    });
                  }
                  console.log("[InviteAutoAccept] Linked as guardian to", existingChildren.length, "existing children");
                } else {
                  // Edge case: other parent accepted but children not found — create them
                  await createChildrenFromMetadata(childrenData, user.id, invite.team_id);
                }
              } else {
                // This parent is first to accept — create children normally
                await createChildrenFromMetadata(childrenData, user.id, invite.team_id);
              }
            } else if (childrenData.length > 0) {
              // No linked invite — standard single parent flow
              const createdIds = await createChildrenFromMetadata(childrenData, user.id, invite.team_id);
              
              // If a second parent was added directly (existing user), link them as guardian
              if (meta.second_parent_user_id && createdIds.length > 0) {
                for (const childId of createdIds) {
                  await supabase.from("child_guardians").insert({
                    child_id: childId,
                    guardian_id: meta.second_parent_user_id,
                    relationship_type: "parent",
                    is_primary: false,
                  }).then(({ error: guardErr }) => {
                    if (guardErr && !guardErr.message?.includes("duplicate")) {
                      console.error("[InviteAutoAccept] Failed to link second parent:", guardErr.message);
                    }
                  });
                }
                console.log("[InviteAutoAccept] Linked second parent", meta.second_parent_user_id, "to", createdIds.length, "children");

                // Send child-added email to the second parent
                try {
                  const childNames = childrenData.map((c: any) => c.name);
                  const firstTeamId = invite.team_id;
                  if (firstTeamId && childNames.length > 0) {
                    const { data: teamInfo } = await supabase
                      .from("teams")
                      .select("name, club_id, clubs:club_id(name, logo_url, contact_email)")
                      .eq("id", firstTeamId)
                      .single();

                    if (teamInfo) {
                      const club = teamInfo.clubs as any;
                      await supabase.functions.invoke("send-email", {
                        body: {
                          toUserId: meta.second_parent_user_id,
                          subject: childNames.length === 1
                            ? `${club?.name || 'Your club'}: See which team ${childNames[0]} is in ⚽`
                            : `${club?.name || 'Your club'}: Your children have been added to ${teamInfo.name} ⚽`,
                          template: "child-added",
                          senderName: club?.name || undefined,
                          replyTo: club?.contact_email || undefined,
                          templateData: {
                            recipientName: "Parent",
                            childrenNames: childNames,
                            teamName: teamInfo.name,
                            clubName: club?.name || "The Club",
                            clubLogoUrl: club?.logo_url || undefined,
                            inviteLink: `${window.location.origin}/teams/${firstTeamId}`,
                          },
                        },
                      });
                      console.log("[InviteAutoAccept] Sent child-added email to second parent:", meta.second_parent_user_id);
                    }
                  }
                } catch (emailErr) {
                  console.error("[InviteAutoAccept] Failed to send child-added email to second parent:", emailErr);
                }
              }
            }
          }

          await supabase
            .from("pending_invites")
            .update({
              status: "accepted",
              accepted_at: new Date().toISOString(),
              invited_user_id: user.id,
            })
            .eq("id", invite.id);
        } catch (err) {
          console.error("[InviteAutoAccept] Unexpected error for invite:", invite.id, err);
        }
      }

      // Refresh roles/membership queries after processing
      queryClient.invalidateQueries({ queryKey: membershipKeys.userRoles() });
      queryClient.invalidateQueries({ queryKey: membershipKeys.pendingInvites() });

      // Apply the inviting club's theme. Seeds when the user has no existing
      // preference; when they're an existing member of a DIFFERENT club we
      // switch anyway (accepting an invite is user-driven) and announce it
      // with an Undo. Never switches when already on the invited club.
      if (firstInvitedClubId && user) {
        await applyInviteClubSwitch(user.id, firstInvitedClubId, setActiveClubTheme, {
          source: "InviteAutoAccept",
        });
      } else if (user) {
        // Defensive: invite may already be accepted, so the pending query was
        // empty — seed from any recent invite for this user instead.
        const fallback = await seedClubThemeFromAnyInvite(user, setActiveClubTheme);
        if (fallback) {
          console.log("[InviteAutoAccept] Applied club filter from accepted invite:", fallback);
        }
      }

    };

    autoAcceptInvites();
  }, [user, pendingInvites, queryClient, setActiveClubTheme]);

  // No UI rendered — purely background logic
  return null;
}
