import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Users,
  UserPlus,
  Check,
  Loader2,
  Plus,
  X,
  CheckCircle2,
  ClipboardList,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { usePageTitle } from "@/hooks/usePageTitle";
import { defaultRsvpAudienceForTeam } from "@/lib/teamAgeDefaults";
import { ClubThemeEditor } from "@/components/ClubThemeEditor";
import { MonogramLogoGenerator } from "@/components/club/MonogramLogoGenerator";
import { SponsorsManager } from "@/components/SponsorsManager";
import { ProFeatureLock } from "@/components/subscription/ProFeatureLock";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { cn } from "@/lib/utils";
import { Crown } from "lucide-react";
import { lookupInvitableUserByEmail } from "@/lib/inviteEmailDedupe";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabClubDetail, getLocalLabTeamList } from "@/lab/fixtureDataLayer";
import {
  StepIntro,
  TeamsStep,
  InviteStep,
  TeamInvitesStep,
} from "@/components/club/setup/ClubSetupWizardSteps";
import type { ClubRole, TeamRole, DraftTeam, DraftInvite } from "@/components/club/setup/ClubSetupWizardSteps";


// ---------- types ----------

interface DraftGroup {
  tempId: string;
  name: string;
  description: string;
  status: "pending" | "saving" | "saved" | "error";
  createdId?: string;
  errorMsg?: string;
}

type ClubRow = Database["public"]["Tables"]["clubs"]["Row"];
type SetupClub = Pick<
  ClubRow,
  | "kind"
  | "name"
  | "contact_email"
  | "logo_url"
  | "theme_primary_h"
  | "theme_primary_s"
  | "theme_primary_l"
  | "theme_secondary_h"
  | "theme_secondary_s"
  | "theme_secondary_l"
  | "theme_accent_h"
  | "theme_accent_s"
  | "theme_accent_l"
  | "theme_dark_primary_h"
  | "theme_dark_primary_s"
  | "theme_dark_primary_l"
  | "theme_dark_secondary_h"
  | "theme_dark_secondary_s"
  | "theme_dark_secondary_l"
  | "theme_dark_accent_h"
  | "theme_dark_accent_s"
  | "theme_dark_accent_l"
  | "show_logo_in_header"
  | "show_name_in_header"
  | "logo_only_mode"
  | "theme_enabled"
  | "primary_sponsor_id"
>;
type SetupTeam = Pick<Database["public"]["Tables"]["teams"]["Row"], "id" | "name" | "level_age">;

const CLUB_ROLE_LABEL: Record<ClubRole, string> = {
  club_admin: "Club Admin",
  committee_member: "Committee Member",
};
const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
};

// Core wizard: three steps only. Branding, Sponsors, Committee and Operational
// Groups are deferred to the post-setup checklist / Club Settings so a new
// club can become operational in the fastest possible flow.
const ALL_STEPS = [
  { id: "teams", label: "Teams", icon: Users },
  { id: "teaminvites", label: "Invite members", icon: UserPlus },
  { id: "review", label: "Review", icon: ClipboardList },
] as const;

// Shell clubs (personal team organisers) use the same three steps.
const SHELL_STEP_IDS = new Set(["teams", "teaminvites", "review"]);




// ---------- page ----------

export default function ClubSetupWizardPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  const providerKey = useIcpLab ? "icp" : "supabase";
  usePageTitle("Set up your club");

  const [stepIndex, setStepIndex] = useState(0);
  const { hasPro, isLoading: proLoading } = useClubProAccess(clubId, { enabled: !useIcpLab });



  const { data: club } = useQuery<SetupClub | null>({
    queryKey: ["club", clubId, "setup", providerKey],
    queryFn: async () => {
      if (useIcpLab) {
        const fixture = getLocalLabClubDetail(clubId!);
        return fixture ? {
          kind: "club",
          name: fixture.name,
          contact_email: null,
          logo_url: fixture.logo_url,
          theme_primary_h: null,
          theme_primary_s: null,
          theme_primary_l: null,
          theme_secondary_h: null,
          theme_secondary_s: null,
          theme_secondary_l: null,
          theme_accent_h: null,
          theme_accent_s: null,
          theme_accent_l: null,
          theme_dark_primary_h: null,
          theme_dark_primary_s: null,
          theme_dark_primary_l: null,
          theme_dark_secondary_h: null,
          theme_dark_secondary_s: null,
          theme_dark_secondary_l: null,
          theme_dark_accent_h: null,
          theme_dark_accent_s: null,
          theme_dark_accent_l: null,
          show_logo_in_header: true,
          show_name_in_header: true,
          logo_only_mode: false,
          theme_enabled: false,
          primary_sponsor_id: null,
        } : null;
      }
      const { data } = await supabase
        .from("clubs")
        .select("*")
        .eq("id", clubId!)
        .maybeSingle();
      return data;

    },
    enabled: !!clubId,
  });

  const isShellClub = club?.kind === "shell";
  const STEPS = useMemo(
    () => ALL_STEPS.filter((s) => (isShellClub ? SHELL_STEP_IDS.has(s.id) : true)),
    [isShellClub],
  );
  const safeStepIndex = Math.min(stepIndex, STEPS.length - 1);
  const step = STEPS[safeStepIndex];



  // Draft state across steps — persisted per club to survive refresh/back-nav
  const storageKey = clubId ? `ignite_wizard_draft_${providerKey}_${clubId}` : null;
  const loadedDraft = useMemo(() => {
    if (!storageKey) return null;
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [storageKey]);

  const [teams, setTeams] = useState<DraftTeam[]>(
    loadedDraft?.teams ?? [{ tempId: crypto.randomUUID(), name: "", levelAge: "" }],
  );
  const [committee, setCommittee] = useState<DraftInvite[]>(loadedDraft?.committee ?? []);
  const [groups, setGroups] = useState<DraftGroup[]>(loadedDraft?.groups ?? []);
  const [teamInvites, setTeamInvites] = useState<DraftInvite[]>(loadedDraft?.teamInvites ?? []);

  // Hydrate from DB: if the club already has teams (e.g. user set them up on
  // another device, or cleared local storage), seed them into the wizard so
  // "Resume setup" doesn't show an empty list and skip team invites.
  const { data: existingTeams } = useQuery<SetupTeam[]>({
    queryKey: ["club-teams", clubId, "setup", providerKey],
    queryFn: async () => {
      if (useIcpLab) {
        return getLocalLabTeamList()
          .filter((team) => team.club_id === clubId)
          .map((team) => ({ id: team.id, name: team.name, level_age: null }));
      }
      const { data } = await supabase
        .from("teams")
        .select("id, name, level_age")
        .eq("club_id", clubId!)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      return data ?? [];
    },
    enabled: !!clubId,
  });

  useEffect(() => {
    if (!existingTeams || existingTeams.length === 0) return;
    setTeams((prev) => {
      const alreadySavedIds = new Set(prev.filter(t => t.createdTeamId).map(t => t.createdTeamId));
      const missing = existingTeams
        .filter((t) => !alreadySavedIds.has(t.id))
        .map((t) => ({
          tempId: crypto.randomUUID(),
          name: t.name ?? "",
          levelAge: t.level_age ?? "",
          createdTeamId: t.id as string,
        }));
      if (missing.length === 0) return prev;
      // Drop empty placeholder rows when we have real teams to show.
      const kept = prev.filter(t => t.createdTeamId || t.name.trim() !== "");
      return [...missing, ...kept];
    });
  }, [existingTeams]);

  useEffect(() => {
    if (useIcpLab || !storageKey) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ teams, committee, groups, teamInvites }),
      );
    } catch {
      /* quota — ignore */
    }
  }, [useIcpLab, storageKey, teams, committee, groups, teamInvites]);

  const savedTeams = teams.filter((t) => t.createdTeamId);


  // ---------- team creation ----------

  const saveTeamMutation = useMutation({
    mutationFn: async (draft: DraftTeam) => {
      if (!draft.name.trim()) throw new Error("Team name is required");
      const { data: teamId, error } = await supabase.rpc(
        "create_team_with_creator_admin",
        {
          p_club_id: clubId!,
          p_name: draft.name.trim(),
          p_level_age: draft.levelAge.trim() || null,
          p_default_rsvp_audience: defaultRsvpAudienceForTeam(
            draft.name,
            draft.levelAge,
          ),
        },
      );
      if (error) throw error;
      return teamId as string;
    },
    onSuccess: (teamId, draft) => {
      setTeams((prev) =>
        prev.map((t) =>
          t.tempId === draft.tempId ? { ...t, createdTeamId: teamId } : t,
        ),
      );
      qc.invalidateQueries({ queryKey: ["club-teams", clubId] });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not create team",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ---------- invite sending ----------

  const sendInvite = async (
    invite: DraftInvite,
    setList: React.Dispatch<React.SetStateAction<DraftInvite[]>>,
  ) => {
    if (!invite.name.trim()) {
      toast({ title: "Add a name first", variant: "destructive" });
      return;
    }
    setList((prev) =>
      prev.map((i) =>
        i.tempId === invite.tempId ? { ...i, status: "sending" } : i,
      ),
    );

    const isTeamRole =
      invite.role === "team_admin" ||
      invite.role === "coach" ||
      invite.role === "player" ||
      invite.role === "parent";

    // Dedupe: skip inviting someone who's already in this club/team
    if (invite.email.trim()) {
      const match = await lookupInvitableUserByEmail({
        email: invite.email.trim(),
        clubId,
        teamId: isTeamRole ? invite.teamId ?? null : null,
      });
      if (match && (match.already_in_club || (isTeamRole && match.already_in_team))) {
        setList((prev) =>
          prev.map((i) =>
            i.tempId === invite.tempId
              ? {
                  ...i,
                  status: "error",
                  errorMsg: `${match.display_name ?? "This user"} is already a member — no invite sent.`,
                }
              : i,
          ),
        );
        toast({
          title: "Already a member",
          description: `${match.display_name ?? invite.email} is already in this ${isTeamRole && match.already_in_team ? "team" : "club"}.`,
        });
        return;
      }
    }

    const inviteToken = crypto.randomUUID();

    const { error: insErr } = await supabase.from("pending_invites").insert({
      club_id: clubId,
      team_id: isTeamRole ? invite.teamId ?? null : null,
      role: invite.role as any,
      invited_user_id: null,
      invited_by_user_id: user!.id,
      invited_label: invite.name.trim(),
      invited_email: invite.email.trim().toLowerCase() || null,
      invite_token: inviteToken,
    } as any);

    if (insErr) {
      setList((prev) =>
        prev.map((i) =>
          i.tempId === invite.tempId
            ? { ...i, status: "error", errorMsg: insErr.message }
            : i,
        ),
      );
      toast({
        title: "Could not create invite",
        description: insErr.message,
        variant: "destructive",
      });
      return;
    }

    const link = `${window.location.origin}/join/p/${inviteToken}`;
    const roleLabel = isTeamRole
      ? TEAM_ROLE_LABEL[invite.role as TeamRole]
      : CLUB_ROLE_LABEL[invite.role as ClubRole];

    // Optional email send
    if (invite.email.trim()) {
      try {
        const { data: res, error: fnErr } = await supabase.functions.invoke(
          "send-email",
          {
            body: {
              to: invite.email.trim(),
              subject: `You're invited to join ${club?.name} as ${roleLabel}`,
              template: "team-invite",
              senderName: club?.name || undefined,
              replyTo: club?.contact_email || undefined,
              templateData: {
                recipientName: invite.name.trim(),
                invitedEmail: invite.email.trim(),
                teamName: club?.name,
                clubName: club?.name,
                roleName: roleLabel,
                inviteLink: link,
                clubLogoUrl: club?.logo_url || undefined,
              },
            },
          },
        );
        if (fnErr) throw fnErr;
        if (!(res?.verified && res?.success)) {
          throw new Error(res?.error || "Email not verified");
        }
        await supabase
          .from("pending_invites")
          .update({
            email_sent_at: new Date().toISOString(),
            email_id: res.emailId,
          } as any)
          .eq("invite_token", inviteToken);
      } catch (err) {
        // Still consider invite created; link is available for manual share
        const msg = err instanceof Error ? err.message : "Email failed";
        await supabase
          .from("pending_invites")
          .update({ email_error: msg } as any)
          .eq("invite_token", inviteToken);
        setList((prev) =>
          prev.map((i) =>
            i.tempId === invite.tempId
              ? { ...i, status: "sent", link, errorMsg: msg }
              : i,
          ),
        );
        toast({
          title: "Invite created — email failed",
          description: "Share the link manually instead.",
        });
        return;
      }
    }

    setList((prev) =>
      prev.map((i) =>
        i.tempId === invite.tempId ? { ...i, status: "sent", link } : i,
      ),
    );
    qc.invalidateQueries({ queryKey: ["pending-invites"] });
    toast({
      title: "Invite sent",
      description: invite.email.trim() || "Share the link with them",
    });
  };

  // ---------- navigation ----------

  const finish = () => {
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch { /* noop */ }
    }
    toast({ title: "Setup complete", description: "You can invite more anytime." });
    navigate(`/clubs/${clubId}`);
  };

  const [savingTeams, setSavingTeams] = useState(false);
  const savingTeamsRef = useRef(false);
  const continueInProgressRef = useRef(false);

  useEffect(() => {
    continueInProgressRef.current = false;
  }, [safeStepIndex]);

  const goNext = async () => {
    if (savingTeamsRef.current || continueInProgressRef.current) return;
    continueInProgressRef.current = true;
    const createdTeamIds: string[] = [];
    const hadSavedTeamsAtStart = teams.some((t) => !!t.createdTeamId);

    // Auto-save any unsaved teams that have a name — no per-row Save needed.
    if (step.id === "teams") {
      const unsaved = teams.filter(
        (t) => t.name.trim() && !t.createdTeamId,
      );
      if (unsaved.length > 0) {
        savingTeamsRef.current = true;
        setSavingTeams(true);
        try {
          for (const t of unsaved) {
            const teamId = await saveTeamMutation.mutateAsync(t);
            createdTeamIds.push(teamId);
          }
        } catch {
          savingTeamsRef.current = false;
          continueInProgressRef.current = false;
          setSavingTeams(false);
          return; // toast surfaced by mutation onError
        }
        savingTeamsRef.current = false;
        setSavingTeams(false);
      }
    }
    if (safeStepIndex < STEPS.length - 1) {
      // Skip team-invites step if no teams (jump straight to next step)
      const canInviteTeams = hadSavedTeamsAtStart || createdTeamIds.length > 0;
      if (STEPS[safeStepIndex + 1].id === "teaminvites" && !canInviteTeams) {
        setStepIndex((i) => i + 2);
        return;
      }
      setStepIndex((i) => i + 1);
    } else {
      finish();
    }
  };

  const goBack = () => {
    if (safeStepIndex === 0) navigate(`/clubs/${clubId}`);
    else setStepIndex((i) => i - 1);
  };

  // No optional Pro steps remain in the core wizard — keep goSkip/isOptionalStep
  // as no-op aliases so any remaining handlers still compile.
  const goSkip = goNext;
  const isOptionalStep = false;

  const progress = ((safeStepIndex + 1) / STEPS.length) * 100;

  if (useIcpLab) {
    return (
      <div className="min-h-[100dvh] bg-background px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <Button variant="ghost" onClick={() => navigate(clubId ? `/clubs/${clubId}` : "/clubs")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to club
          </Button>
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
            <h1 className="text-lg font-semibold">Club setup is unavailable in ICP lab mode</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {club
                ? `${club.name} is a synthetic fixture. Team creation, invitations, branding, and setup progress are not persisted.`
                : "This synthetic club is unavailable. Team creation, invitations, branding, and setup progress are not enabled."}
            </p>
          </div>
          {existingTeams && existingTeams.length > 0 && (
            <div className="rounded-xl border p-4">
              <h2 className="font-medium">Synthetic teams</h2>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {existingTeams.map((team) => <li key={team.id}>{team.name}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 border-b">
        <div className="px-4 py-3 flex items-center gap-3 max-w-2xl mx-auto w-full">
          <Button variant="ghost" size="icon" onClick={goBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold truncate">
              {isShellClub
                ? "Set up your team"
                : `Set up ${club?.name || "your club"}`}
            </h1>
            <p className="text-xs text-muted-foreground">
              Step {safeStepIndex + 1} of {STEPS.length}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={finish}>
            Exit
          </Button>
        </div>
        {/* Progress bar */}
        <div className="px-4 max-w-2xl mx-auto w-full">
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        {/* Compact 3-step indicator — always fits on screen, no scrollbar */}
        <div className="px-4 pt-2.5 pb-3 max-w-2xl mx-auto w-full">
          <div className="flex items-center justify-between gap-1">
            {STEPS.map((s, i) => {
              const active = i === safeStepIndex;
              const done = i < safeStepIndex;
              return (
                <div key={s.id} className="flex items-center flex-1 min-w-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setStepIndex(i)}
                    className={cn(
                      "flex items-center gap-1.5 min-w-0 flex-1 px-2 py-1 rounded-md text-[11px] sm:text-xs font-medium transition-colors",
                      active
                        ? "text-primary"
                        : done
                          ? "text-emerald-600"
                          : "text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-semibold shrink-0",
                        active
                          ? "bg-primary text-primary-foreground"
                          : done
                            ? "bg-emerald-500 text-white"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {done ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    <span className="truncate">{s.label}</span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>


      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-5 pb-32 max-w-2xl mx-auto w-full space-y-4">
          {step.id === "teams" && (
            <TeamsStep
              teams={teams}
              setTeams={setTeams}
              onSave={(t) => saveTeamMutation.mutate(t)}
              saving={saveTeamMutation.isPending}
            />
          )}

          {/* Branding, Sponsors, Committee and Working Groups intentionally
              removed from the core wizard — surfaced via the post-setup
              checklist and Club Settings. */}




          {step.id === "teaminvites" && (
            <TeamInvitesStep
              teams={savedTeams}
              list={teamInvites}
              setList={setTeamInvites}
              onSend={(inv) => sendInvite(inv, setTeamInvites)}
            />
          )}

          {step.id === "review" && (
            <ReviewStep
              clubId={clubId!}
              clubName={club?.name}
              club={club}
              userId={user!.id}
              teams={savedTeams}
              committee={committee}
              setCommittee={setCommittee}
              groups={groups}
              setGroups={setGroups}
              teamInvites={teamInvites}
              onSendInvite={(inv) => sendInvite(inv, setCommittee)}
              onJumpToStep={(id) => {
                const idx = STEPS.findIndex((s) => s.id === id);
                if (idx >= 0) setStepIndex(idx);
              }}
            />

          )}


        </div>
      </div>

      {/* Footer — sticky, always visible on mobile so Continue is reachable */}
      <div
        className="sticky bottom-0 border-t bg-background/95 backdrop-blur-none px-4 py-3"
        style={{ paddingBottom: `max(0.75rem, env(safe-area-inset-bottom))` }}
      >
        <div className="max-w-2xl mx-auto space-y-2">
          <div className="flex gap-2">
            {step.id === "review" ? (
              <Button
                variant="outline"
                onClick={() => {
                  const idx = STEPS.findIndex((s) => s.id === "teaminvites");
                  if (idx >= 0) setStepIndex(idx);
                }}
                className="flex-1"
              >
                <UserPlus className="h-4 w-4 mr-1" /> Invite more members
              </Button>
            ) : (
              <Button variant="outline" onClick={goBack} className="flex-1">
                Back
              </Button>
            )}
            <Button
              onClick={goNext}
              disabled={savingTeams}
              className={cn(
                "flex-[2]",
                safeStepIndex === STEPS.length - 1 &&
                  "bg-emerald-600 hover:bg-emerald-700 text-white",
              )}
            >
              {savingTeams ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : safeStepIndex === STEPS.length - 1 ? (
                <>
                  <Check className="h-4 w-4 mr-1" /> Finish setup
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </div>
          {step.id === "teaminvites" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={goNext}
              className="w-full text-muted-foreground"
            >
              I’ll invite people later
            </Button>
          )}
        </div>
      </div>

    </div>
  );
}

// ---------- step: operational groups (sub-committees) ----------

function OperationalGroupsStep({
  clubId,
  userId,
  groups,
  setGroups,
}: {
  clubId: string;
  userId: string;
  groups: DraftGroup[];
  setGroups: React.Dispatch<React.SetStateAction<DraftGroup[]>>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const addRow = () =>
    setGroups((prev) => [
      ...prev,
      { tempId: crypto.randomUUID(), name: "", description: "", status: "pending" },
    ]);
  const remove = (id: string) =>
    setGroups((prev) => prev.filter((g) => g.tempId !== id));
  const update = (id: string, patch: Partial<DraftGroup>) =>
    setGroups((prev) => prev.map((g) => (g.tempId === id ? { ...g, ...patch } : g)));

  const suggestions = ["Fundraising", "Grounds & Facilities", "Events", "Sponsorship", "Registrations"];

  const save = async (g: DraftGroup) => {
    if (!g.name.trim()) {
      toast({ title: "Add a group name first", variant: "destructive" });
      return;
    }
    update(g.tempId, { status: "saving" });
    const { data, error } = await supabase
      .from("chat_groups")
      .insert({
        name: g.name.trim(),
        club_id: clubId,
        created_by: userId,
        allowed_roles: ["committee_member", "club_admin"],
        membership_mode: "role",
        category: "subcommittee",
        join_policy: "invite_only",
      } as any)
      .select("id")
      .single();
    if (error) {
      update(g.tempId, { status: "error", errorMsg: error.message });
      toast({ title: "Could not create group", description: error.message, variant: "destructive" });
      return;
    }
    update(g.tempId, { status: "saved", createdId: data.id as string });

    // Auto-seed existing club_admin + committee_member users into the group
    // so they're members immediately (not just role-eligible).
    try {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", clubId)
        .in("role", ["club_admin", "committee_member"]);
      const userIds = Array.from(
        new Set([userId, ...(roleRows ?? []).map((r: any) => r.user_id)]),
      );
      if (userIds.length > 0) {
        await supabase.from("group_members").upsert(
          userIds.map((uid) => ({
            group_id: data.id,
            user_id: uid,
            added_by: userId,
          })) as any,
          { onConflict: "group_id,user_id", ignoreDuplicates: true } as any,
        );
      }
    } catch {
      /* seeding failure is non-fatal — role-based access still applies */
    }

    qc.invalidateQueries({ queryKey: ["chat-groups"] });
  };

  return (
    <div className="space-y-4">
      <StepIntro
        icon={UserPlus}
        title="Create working groups (optional)"
        subtitle="Sub-committees for how you organise work — e.g. Fundraising, Grounds, Events. Each one is just a private chat group for that committee. Skip this if you're not sure — you can add them anytime."
      />

      {groups.length === 0 && (
        <div className="rounded-xl border border-dashed p-4 space-y-3">
          <p className="text-xs text-muted-foreground text-center">
            Quick add — tap a suggestion or create your own.
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {suggestions.map((s) => (
              <Button
                key={s}
                variant="outline"
                size="sm"
                onClick={() =>
                  setGroups((prev) => [
                    ...prev,
                    { tempId: crypto.randomUUID(), name: s, description: "", status: "pending" },
                  ])
                }
              >
                <Plus className="h-3 w-3 mr-1" /> {s}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {groups.map((g) => {
          const saved = g.status === "saved";
          const saving = g.status === "saving";
          return (
            <div
              key={g.tempId}
              className={cn(
                "rounded-xl border p-3 space-y-2",
                saved ? "bg-emerald-500/5 border-emerald-500/30" : "bg-card",
              )}
            >
              <div className="flex items-center gap-2">
                <Input
                  value={g.name}
                  onChange={(e) => update(g.tempId, { name: e.target.value })}
                  placeholder="Group name (e.g. Fundraising)"
                  disabled={saved || saving}
                  className="h-9"
                />
                {saved ? (
                  <Badge variant="outline" className="text-emerald-600 border-emerald-500/40 shrink-0">
                    <Check className="h-3 w-3 mr-1" /> Created
                  </Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => remove(g.tempId)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {!saved && (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => save(g)}
                  disabled={!g.name.trim() || saving}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create group"}
                </Button>
              )}
              {g.errorMsg && !saved && (
                <p className="text-xs text-destructive">{g.errorMsg}</p>
              )}
            </div>
          );
        })}
      </div>

      <Button variant="outline" size="sm" onClick={addRow} className="w-full">
        <Plus className="h-4 w-4 mr-1" /> Add group
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        You can add members to each group from the group's chat once people have joined the club.
      </p>
    </div>
  );
}

// ---------- step: review & finish ----------

function ReviewStep({
  clubId,
  clubName,
  club,
  userId,
  teams,
  committee,
  setCommittee,
  groups,
  setGroups,
  teamInvites,
  onSendInvite,
  onJumpToStep,
}: {
  clubId: string;
  clubName?: string | null;
  club?: any;
  userId: string;
  teams: DraftTeam[];
  committee: DraftInvite[];
  setCommittee: React.Dispatch<React.SetStateAction<DraftInvite[]>>;
  groups: DraftGroup[];
  setGroups: React.Dispatch<React.SetStateAction<DraftGroup[]>>;
  teamInvites: DraftInvite[];
  onSendInvite: (inv: DraftInvite) => void;
  onJumpToStep: (id: string) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [brandingOpen, setBrandingOpen] = useState(false);
  const [sponsorsOpen, setSponsorsOpen] = useState(false);
  const [committeeOpen, setCommitteeOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const { hasPro } = useClubProAccess(clubId);
  const sentTeamInv = teamInvites.filter((i) => i.status === "sent").length;
  const pendingTeamInv = teamInvites.length - sentTeamInv;
  const sentCommittee = committee.filter((i) => i.status === "sent").length;
  const savedGroups = groups.filter((g) => g.status === "saved").length;



  // Section 1 — completed setup summary (only what the wizard actually asked for).
  const summaryRows: {
    id: string;
    label: string;
    detail: string;
    done: boolean;
  }[] = [
    {
      id: "teams",
      label: "Teams",
      detail:
        teams.length === 0
          ? "None yet"
          : `${teams.length} created`,
      done: teams.length > 0,
    },
    {
      id: "teaminvites",
      label: "Member invitations",
      detail:
        teamInvites.length === 0
          ? "Invite later"
          : `${sentTeamInv} invited${pendingTeamInv ? `, ${pendingTeamInv} not sent` : ""}`,
      // No green tick just for viewing — only when at least one was sent.
      done: sentTeamInv > 0,
    },
  ];

  // Section 2 — optional next steps (all inline within the wizard).
  const optionalItems: {
    id: string;
    label: string;
    hint: string;
  }[] = [
    {
      id: "committee",
      label: "Invite committee members",
      hint: sentCommittee > 0 ? `${sentCommittee} invited` : "Optional",
    },
    {
      id: "groups",
      label: "Create Subcommittees",
      hint: savedGroups > 0 ? `${savedGroups} created` : "Optional",
    },
    {
      id: "branding",
      label: "Add club branding",
      hint: "Optional",
    },
    {
      id: "sponsors",
      label: "Add sponsors",
      hint: "Optional",
    },
  ];

  return (
    <div className="space-y-4">
      <StepIntro
        icon={ClipboardList}
        title={`${clubName || "Your club"} is nearly ready`}
        subtitle="Review what you've set up. Select an item to make changes, or finish setup and enter your club."
      />

      {/* Section 1 — Setup summary */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
          Setup summary
        </p>
        <div className="rounded-xl border divide-y bg-card">
          {summaryRows.map((r) => (
            <button
              key={r.id}
              onClick={() => onJumpToStep(r.id)}
              className="w-full flex items-center justify-between px-3 py-3 text-left hover:bg-muted/60 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                {r.done ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                ) : (
                  <span className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.label}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.detail}
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </div>

      {/* Section 2 — Optional next steps */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
          Optional next steps
        </p>
        <div className="rounded-xl border divide-y bg-card">
          {optionalItems.map((item) => {
            const isBranding = item.id === "branding";
            const isSponsors = item.id === "sponsors";
            const isCommittee = item.id === "committee";
            const isGroups = item.id === "groups";
            const isOpen =
              (isBranding && brandingOpen) ||
              (isSponsors && sponsorsOpen) ||
              (isCommittee && committeeOpen) ||
              (isGroups && groupsOpen);
            const handleClick = () => {
              if (isBranding) setBrandingOpen((v) => !v);
              else if (isSponsors) setSponsorsOpen((v) => !v);
              else if (isCommittee) setCommitteeOpen((v) => !v);
              else if (isGroups) setGroupsOpen((v) => !v);
            };
            return (
              <div key={item.id}>
                <button
                  onClick={handleClick}
                  className="w-full flex items-center justify-between px-3 py-3 text-left hover:bg-muted/60 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                    <p className="text-sm font-medium truncate">{item.label}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {item.hint}
                    </span>
                    <ArrowRight
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        isOpen && "rotate-90",
                      )}
                    />
                  </div>
                </button>
                {isCommittee && committeeOpen && (
                  <div className="px-3 pb-4 pt-1 bg-muted/20">
                    <InviteStep
                      title="Invite committee members"
                      subtitle="Committee members can help run the club — they'll get admin access to committee chats and shared resources. Add as many as you like; you can invite more later."
                      roleOptions={[{ value: "committee_member", label: "Committee Member" }]}
                      defaultRole="committee_member"
                      list={committee}
                      setList={setCommittee}
                      onSend={onSendInvite}
                    />
                  </div>
                )}
                {isGroups && groupsOpen && (
                  <div className="px-3 pb-4 pt-1 bg-muted/20">
                    <OperationalGroupsStep
                      clubId={clubId}
                      userId={userId}
                      groups={groups}
                      setGroups={setGroups}
                    />
                  </div>
                )}
                {isBranding && brandingOpen && (
                  <div className="px-3 pb-4 pt-1 space-y-3 bg-muted/20">
                    {!hasPro && (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                        You can configure your colours and logo now — they'll be applied across the app automatically once your club is on the <strong>Pro</strong> plan.
                      </div>
                    )}
                    {club ? (
                      <ClubThemeEditor
                        clubId={clubId}
                        clubLogoUrl={club.logo_url}
                        initialPrimary={club.theme_primary_h !== null && club.theme_primary_h !== undefined ? { h: club.theme_primary_h, s: club.theme_primary_s, l: club.theme_primary_l } : undefined}
                        initialSecondary={club.theme_secondary_h !== null && club.theme_secondary_h !== undefined ? { h: club.theme_secondary_h, s: club.theme_secondary_s, l: club.theme_secondary_l } : undefined}
                        initialAccent={club.theme_accent_h !== null && club.theme_accent_h !== undefined ? { h: club.theme_accent_h, s: club.theme_accent_s, l: club.theme_accent_l } : undefined}
                        initialDarkPrimary={club.theme_dark_primary_h !== null && club.theme_dark_primary_h !== undefined ? { h: club.theme_dark_primary_h, s: club.theme_dark_primary_s, l: club.theme_dark_primary_l } : undefined}
                        initialDarkSecondary={club.theme_dark_secondary_h !== null && club.theme_dark_secondary_h !== undefined ? { h: club.theme_dark_secondary_h, s: club.theme_dark_secondary_s, l: club.theme_dark_secondary_l } : undefined}
                        initialDarkAccent={club.theme_dark_accent_h !== null && club.theme_dark_accent_h !== undefined ? { h: club.theme_dark_accent_h, s: club.theme_dark_accent_s, l: club.theme_dark_accent_l } : undefined}
                        initialShowLogoInHeader={club.show_logo_in_header}
                        initialShowNameInHeader={club.show_name_in_header ?? true}
                        initialLogoOnlyMode={club.logo_only_mode ?? false}
                        initialThemeEnabled={club.theme_enabled ?? true}
                        onSave={() => {
                          qc.invalidateQueries({ queryKey: ["club", clubId, "setup"] });
                          qc.invalidateQueries({ queryKey: ["club-themes"] });
                        }}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">Loading club details…</p>
                    )}
                  </div>
                )}
                {isSponsors && sponsorsOpen && (
                  <div className="px-3 pb-4 pt-1 space-y-3 bg-muted/20">
                    {!hasPro && (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                        You can add sponsors now — they'll appear across the app (club page, media, chat, events) automatically once your club is on the <strong>Pro</strong> plan.
                      </div>
                    )}
                    <SponsorsManager
                      clubId={clubId}
                      currentPrimarySponsorId={club?.primary_sponsor_id || null}
                      onPrimaryChange={() => qc.invalidateQueries({ queryKey: ["club", clubId, "setup"] })}
                    />
                  </div>
                )}
              </div>
            );
          })}

        </div>
      </div>

      {/* Free Pro trial CTA */}
      <button
        onClick={() => navigate(`/clubs/${clubId}/upgrade?trial=1`)}
        className="w-full text-left rounded-xl border border-primary/40 bg-gradient-to-br from-primary/10 via-primary/5 to-background p-4 hover:from-primary/15 transition-colors"
      >
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <Crown className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Try Club Pro free for 30 days</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Unlock sponsors, branding, unlimited storage and more. Cancel anytime — no charge for 30 days.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-primary shrink-0 mt-1" />
        </div>
      </button>

      <p className="text-xs text-muted-foreground text-center">
        Draft is auto-saved — you can leave and come back anytime before finishing.
      </p>
    </div>
  );
}






// ---------- brand preset picker (quick-apply palettes) ----------

type Hsl = { h: number; s: number; l: number };
interface BrandPreset {
  id: string;
  name: string;
  primary: Hsl;
  secondary: Hsl;
  accent: Hsl;
}

const BRAND_PRESETS: BrandPreset[] = [
  { id: "ignite",    name: "Ignite Orange", primary: { h: 20,  s: 90, l: 55 }, secondary: { h: 220, s: 30, l: 20 }, accent: { h: 40,  s: 95, l: 60 } },
  { id: "royal",     name: "Royal Blue",    primary: { h: 220, s: 85, l: 45 }, secondary: { h: 220, s: 40, l: 20 }, accent: { h: 45,  s: 95, l: 55 } },
  { id: "forest",    name: "Forest Green",  primary: { h: 145, s: 55, l: 32 }, secondary: { h: 30,  s: 25, l: 18 }, accent: { h: 40,  s: 90, l: 55 } },
  { id: "crimson",   name: "Crimson",       primary: { h: 350, s: 75, l: 42 }, secondary: { h: 220, s: 20, l: 15 }, accent: { h: 45,  s: 90, l: 55 } },
  { id: "navy-gold", name: "Navy & Gold",   primary: { h: 220, s: 70, l: 25 }, secondary: { h: 220, s: 50, l: 15 }, accent: { h: 45,  s: 85, l: 55 } },
  { id: "purple",    name: "Deep Purple",   primary: { h: 265, s: 60, l: 42 }, secondary: { h: 260, s: 30, l: 18 }, accent: { h: 320, s: 75, l: 60 } },
  { id: "teal",      name: "Teal",          primary: { h: 180, s: 65, l: 38 }, secondary: { h: 200, s: 40, l: 18 }, accent: { h: 15,  s: 85, l: 60 } },
  { id: "mono",      name: "Mono Charcoal", primary: { h: 220, s: 10, l: 25 }, secondary: { h: 220, s: 8,  l: 15 }, accent: { h: 20,  s: 85, l: 55 } },
];

const hslCss = (c: Hsl) => `hsl(${c.h}, ${c.s}%, ${c.l}%)`;

function BrandPresetPicker({
  clubId,
  onApplied,
}: {
  clubId: string;
  onApplied: () => void;
}) {
  const { toast } = useToast();
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const apply = async (p: BrandPreset) => {
    setApplyingId(p.id);
    const { error } = await supabase
      .from("clubs")
      .update({
        theme_primary_h: p.primary.h,
        theme_primary_s: p.primary.s,
        theme_primary_l: p.primary.l,
        theme_secondary_h: p.secondary.h,
        theme_secondary_s: p.secondary.s,
        theme_secondary_l: p.secondary.l,
        theme_accent_h: p.accent.h,
        theme_accent_s: p.accent.s,
        theme_accent_l: p.accent.l,
        theme_enabled: true,
      } as any)
      .eq("id", clubId);
    setApplyingId(null);
    if (error) {
      toast({ title: "Could not apply preset", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${p.name} applied`, description: "Tweak individual colours below if you like." });
    onApplied();
  };

  return (
    <div className="rounded-xl border p-3 space-y-3 bg-card">
      <div>
        <p className="text-sm font-semibold">Quick brand palettes</p>
        <p className="text-xs text-muted-foreground">
          Tap a palette to apply it — you can fine-tune each colour below.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {BRAND_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={applyingId !== null}
            onClick={() => apply(p)}
            className={cn(
              "group rounded-lg border p-2 text-left transition-all hover:border-primary hover:shadow-sm active:scale-[0.98]",
              applyingId === p.id && "opacity-60",
            )}
          >
            <div className="flex gap-1 mb-1.5 h-6 rounded overflow-hidden">
              <div className="flex-1" style={{ background: hslCss(p.primary) }} />
              <div className="flex-1" style={{ background: hslCss(p.secondary) }} />
              <div className="flex-1" style={{ background: hslCss(p.accent) }} />
            </div>
            <p className="text-[11px] font-medium truncate">{p.name}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
