import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { UserPlus, Search, Loader2, Mail, X, Check, Send, Users, Plus, Upload, Baby, MessageSquare, AlertTriangle, Share2, Pencil } from "lucide-react";
import TeamJoinLinkCard from "@/components/invite/TeamJoinLinkCard";
import { parseRecipients, looksLikeMultiRecipient } from "@/components/invite/recipientParser";
const MemberCSVImportDialog = lazyWithRetry(() => import("@/components/MemberCSVImportDialog").then(m => ({ default: m.MemberCSVImportDialog })));
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ToastAction } from "@/components/ui/toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";
import { useNativeKeyboardBottomInset } from "@/hooks/useNativeKeyboardBottomInset";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { secondParentValidationError } from "@/features/membership/secondParentInvite";
import {
  ChildAndSecondGuardianFields,
  type BulkChild,
} from "@/components/members/ChildAndSecondGuardianFields";
import {
  AddTeamMemberBulkSuccessSheet,
  AddTeamMemberInviteSuccessSheet,
  type BulkMemberResult,
} from "@/components/members/AddTeamMemberSuccessSheets";
import { AddTeamMemberBulkMemberList } from "@/components/members/AddTeamMemberBulkMemberList";
import { useAddTeamMemberRosterData } from "@/hooks/useAddTeamMemberRosterData";
import { useAddTeamMemberSearch } from "@/hooks/useAddTeamMemberSearch";
import { useAddExistingTeamMemberMutation } from "@/hooks/useAddExistingTeamMemberMutation";
import { useAddPendingTeamMemberMutation } from "@/hooks/useAddPendingTeamMemberMutation";
import { useAddBulkTeamMembersMutation } from "@/hooks/useAddBulkTeamMembersMutation";

interface BulkMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  children: BulkChild[];
  selectedUser?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  // Second guardian fields for parent role
  secondParentName?: string;
  secondParentEmail?: string;
  secondParentSearch?: string;
  selectedSecondParent?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

type TeamRole = "player" | "parent" | "coach" | "team_admin";
type TeamType = "junior" | "senior" | "mixed";

type AppRole = Database["public"]["Enums"]["app_role"];

const roleLabels: Record<AppRole, string> = {
  basic_user: "Member",
  club_admin: "Club admin",
  team_admin: "Team admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  app_admin: "App admin",
  league_admin: "League admin",
  committee_member: "Committee member",
  association_admin: "Association admin",
  competition_admin: "Competition admin",
};

function formatPendingInviteSubtitle(
  role: string,
  teamName: string | null | undefined,
  childName: string | null | undefined,
): string {
  const roleLabel = roleLabels[role as AppRole] || role.replace(/_/g, " ") || "Member";
  const scope = teamName ? `— ${teamName}` : "(club)";
  const childSuffix = childName ? ` (${childName})` : "";
  return `Pending: ${roleLabel} ${scope}${childSuffix}`;
}

interface AddTeamMemberSheetProps {
  teamId: string;
  teamName: string;
  clubId: string;
  teamType?: TeamType;
  /** True when the user is a club admin but NOT a direct member of this team */
  isClubAdminOnly?: boolean;
  /** Whether the user can use bulk/multiple invite mode (admin/coach only) */
  canBulkInvite?: boolean;
  /** Trigger button style: "default" shows full button, "icon" shows icon-only, "none" hides trigger (use externalOpen) */
  triggerVariant?: "default" | "icon" | "none";
  /** Externally controlled open state */
  externalOpen?: boolean;
  /** Callback when open state changes externally */
  onExternalOpenChange?: (open: boolean) => void;
}

const allRoleOptions: { value: TeamRole; label: string; description: string; color: string; icon?: string; juniorOnly?: boolean; seniorOnly?: boolean }[] = [
  { value: "parent", label: "Parent", description: "Add parent + child players", color: "bg-pink-500/20 text-pink-600 border-pink-500/30", icon: "👶", juniorOnly: true },
  { value: "player", label: "Adult Player", description: "18+ team player", color: "bg-amber-500/20 text-amber-600 border-amber-500/30", seniorOnly: true },
  { value: "coach", label: "Coach", description: "Team coach", color: "bg-emerald-500/20 text-emerald-600 border-emerald-500/30" },
  { value: "team_admin", label: "Team Admin", description: "Full admin access", color: "bg-blue-500/20 text-blue-600 border-blue-500/30" },
];

export default function AddTeamMemberSheet({ teamId, teamName, clubId, teamType = "mixed", isClubAdminOnly = false, canBulkInvite = true, triggerVariant = "default", externalOpen, onExternalOpenChange }: AddTeamMemberSheetProps) {
  // Filter role options based on team type
  const roleOptions = allRoleOptions.filter(opt => {
    if (teamType === "junior") {
      // Junior teams: no adult players
      return !opt.seniorOnly;
    }
    // Senior + mixed: keep Parent available — an adult player on a senior team
    // may still need a child added/invited to the same team.
    return true;
  });


  // Get default role based on team type
  const getDefaultRole = (): TeamRole => {
    if (teamType === "junior") return "parent";
    return "player"; // senior and mixed default to adult player
  };

  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * Toast helper that appends a "View pending invites (N)" action button
   * after a successful invite is created. Fetches the live pending count
   * for this team so the badge stays accurate.
   * The action navigates to the team detail page (where PendingInvitesList
   * is rendered); if already there it's a no-op and just dismisses the toast.
   */
  const toastInviteSuccess = useCallback(
    async (opts: { title: string; description?: string; variant?: "default" | "destructive" }) => {
      let pendingCount = 0;
      try {
        const { count } = await supabase
          .from("pending_invites")
          .select("id", { count: "exact", head: true })
          .eq("team_id", teamId)
          .eq("status", "pending");
        pendingCount = count ?? 0;
      } catch {
        // ignore — fall back to a count-less link
      }

      const teamPath = `/teams/${teamId}`;
      const alreadyOnTeam = location.pathname === teamPath;

      toast({
        title: opts.title,
        description: opts.description,
        variant: opts.variant,
        action: pendingCount > 0 ? (
          <ToastAction
            altText={`View ${pendingCount} pending invite${pendingCount === 1 ? "" : "s"}`}
            onClick={() => {
              if (!alreadyOnTeam) navigate(teamPath);
            }}
          >
            View pending ({pendingCount})
          </ToastAction>
        ) : undefined,
      });
    },
    [teamId, toast, navigate, location.pathname],
  );

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = externalOpen !== undefined;
  const open = isControlled ? externalOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) onExternalOpenChange?.(v);
    else setInternalOpen(v);
  };
  const [nameInput, setNameInput] = useState("");
  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null>(null);
  const [customEmail, setCustomEmail] = useState("");
  // Optional phone used ONLY to build SMS/WhatsApp share links on the success step.
  // Never sent to Supabase, never persisted — cleared on reset.
  const [sharePhone, setSharePhone] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"email" | "share">("share");
  const [selectedRole, setSelectedRole] = useState<TeamRole>(getDefaultRole());
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteShareLink, setInviteShareLink] = useState<string | null>(null);
  const [isSendingNotification, setIsSendingNotification] = useState(false);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  // Single invite children (for parent role)
  const [singleChildren, setSingleChildren] = useState<BulkChild[]>([]);
  const [bulkMembers, setBulkMembers] = useState<BulkMember[]>([
    { id: crypto.randomUUID(), name: "", email: "", role: "parent", children: [], selectedUser: null },
  ]);
  const [bulkResults, setBulkResults] = useState<BulkMemberResult[]>([]);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [customMessage, setCustomMessage] = useState("");
  const [showMessageEditor, setShowMessageEditor] = useState(false);
  // Second parent fields (for parent role)
  const [secondParentName, setSecondParentName] = useState("");
  const [secondParentEmail, setSecondParentEmail] = useState("");
  const [secondParentSearch, setSecondParentSearch] = useState("");
  const [selectedSecondParent, setSelectedSecondParent] = useState<{ id: string; display_name: string | null; avatar_url: string | null } | null>(null);
  const debouncedSecondParentSearch = useDebounce(secondParentSearch, 300);

  const debouncedNameInput = useDebounce(nameInput, 300);
  // Fixed-position sheet: use the REMAINING keyboard overlay (after any OEM
  // WebView resize) — the total IME height over-reports on Android and leaves
  // a blank gap between the sheet and the keyboard.
  const nativeKbHeight = useNativeKeyboardBottomInset();
  const autoChildTriggered = useRef(false);
  const [nameConfirmed, setNameConfirmed] = useState(false);
  const roleSectionRef = useRef<HTMLDivElement | null>(null);
  // Single-screen invite form: the share link is visible immediately on open
  // (auto-created for the default role), with the person / role / children /
  // delivery form below it on one scrolling screen — no chooser step.
  const inviteByNameOpen = true;
  // Person is "ready" once an existing user is picked or any name is typed —
  // role / children / delivery sections disclose progressively below the name.
  const personReady = !!selectedUser || nameInput.trim().length > 0;

  // When the name is confirmed (or an existing user is selected), the role
  // selector becomes the active step. Dismiss the soft keyboard and scroll
  // the role buttons into view so the user can see what they're picking on
  // small iOS viewports where the keyboard previously hid them.
  useEffect(() => {
    if (!nameConfirmed && !selectedUser) return;
    try {
      const active = document.activeElement as HTMLElement | null;
      if (active && typeof active.blur === "function") active.blur();
    } catch {}
    const t = setTimeout(() => {
      roleSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => clearTimeout(t);
  }, [nameConfirmed, selectedUser]);

  // Auto-open first child input when Parent role is selected and name is confirmed (existing user or tick)
  useEffect(() => {
    const nameReady = selectedUser || nameConfirmed || nameInput.trim().length > 0;
    if (selectedRole === "parent" && nameReady && singleChildren.length === 0 && !autoChildTriggered.current) {
      autoChildTriggered.current = true;
      setSingleChildren([{ id: crypto.randomUUID(), name: "", yearOfBirth: "", jerseyNumber: "" }]);
    }
    if (selectedRole !== "parent") {
      autoChildTriggered.current = false;
    }
  }, [selectedRole, selectedUser, nameConfirmed, nameInput, singleChildren.length]);

  const {
    existingMembers,
    clubBranding,
    clubChildren,
    pendingInviteChildren,
    memberNameMatchesExisting,
  } = useAddTeamMemberRosterData({
    supabase,
    open,
    teamId,
    clubId,
    needsParentData:
      selectedRole === "parent" || bulkMembers.some((member) => member.role === "parent"),
  });
  // Club-selected invite email style: only the "discover" option uses the
  // "See which team X is in" subject line.
  const discoverEmailStyle = (clubBranding as { invite_email_style?: string } | null | undefined)?.invite_email_style === 'discover';

  const {
    filteredResults,
    filteredPendingResults,
    identityMap,
    isSearching,
    bulkSearchMap,
    bulkSecondParentMap,
    filteredSecondParentResults,
  } = useAddTeamMemberSearch({
    supabase,
    open,
    mode,
    clubId,
    teamId,
    debouncedNameInput,
    debouncedSecondParentSearch,
    selectedUser,
    selectedSecondParent,
    bulkMembers,
  });

  // Find matching existing children by partial name (case-insensitive), including pending invite children
  const findMatchingChildren = (name: string) => {
    if (!name.trim() || name.trim().length < 2) return [];
    const query = name.trim().toLowerCase();

    // Search confirmed children
    const confirmedMatches = clubChildren
      .filter(c => c.name.toLowerCase().includes(query))
      .map(c => ({ ...c, isPending: false as const }));

    // Search pending invite children (exclude those already in confirmed matches by name)
    const confirmedNames = new Set(confirmedMatches.map(c => c.name.toLowerCase()));
    const pendingMatches = pendingInviteChildren
      .filter(c => c.name.toLowerCase().includes(query) && !confirmedNames.has(c.name.toLowerCase()));

    // Return confirmed first, then pending
    return [...confirmedMatches, ...pendingMatches].slice(0, 5);
  };

  // Create a unique invite token for a pending invite (name-restricted)
  const createPendingInviteToken = (): string => {
    return crypto.randomUUID();
  };

  const isDuplicateError = (error: { code?: string | null; message?: string | null } | null | undefined) => {
    const message = error?.message?.toLowerCase() || "";
    return error?.code === "23505" || message.includes("duplicate") || message.includes("unique constraint");
  };

  // Get or create generic invite link for the selected role (used for existing users or when no name restriction)
  const getOrCreateInviteLink = async (role: TeamRole): Promise<string> => {
    // First check for existing invite
    const { data: existingInvite } = await supabase
      .from("team_invites")
      .select("token")
      .eq("team_id", teamId)
      .eq("role", role)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingInvite?.token) {
      return `${window.location.origin}/join/${existingInvite.token}`;
    }

    // Create new invite
    const token = crypto.randomUUID();
    const { error } = await supabase.from("team_invites").insert({
      team_id: teamId,
      role: role,
      token: token,
      created_by: user!.id,
    } as any);

    if (error) throw error;
    return `${window.location.origin}/join/${token}`;
  };

  const addExistingUserMutation = useAddExistingTeamMemberMutation({
    supabase,
    queryClient,
    userId: user?.id,
    teamId,
    teamName,
    clubId,
    selectedUser,
    selectedRole,
    selectedRoleLabel:
      roleOptions.find((role) => role.value === selectedRole)?.label || selectedRole,
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
    onComplete: () => handleClose(),
  });

  const addPendingMemberMutation = useAddPendingTeamMemberMutation({
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
  });

  const addBulkMembersMutation = useAddBulkTeamMembersMutation({
    supabase,
    queryClient,
    user,
    teamId,
    teamName,
    clubId,
    bulkMembers,
    clubChildren,
    clubBranding,
    discoverEmailStyle,
    customMessage,
    roleOptions,
    isDuplicateError,
    toast,
    toastInviteSuccess,
    setBulkResults,
  });

  const buildInviteShareMessage = (overrideLink?: string) => {
    const clubName = clubBranding?.name || "";
    const childrenNames = singleChildren.filter(c => c.name.trim()).map(c => c.name.trim());
    const isAdminRole = ['club_admin', 'committee_member', 'coach', 'team_admin'].includes(selectedRole);
    const roleName = roleOptions.find(r => r.value === selectedRole)?.label || selectedRole;
    const email = customEmail.trim();
    const appDownload = `\n\n📲 Get the app:\nApple: https://reference.invalid https://reference.invalid`;
    const emailNote = email ? `\n\nSign up with ${email} so your account links automatically.` : "";
    const link = overrideLink || inviteShareLink || inviteLink || "";

    if (isAdminRole && teamName) {
      return `You've been invited to join ${teamName}${clubName ? ` at ${clubName}` : ""} as ${roleName}. Tap here to get started: ${link}${appDownload}${emailNote}`;
    }
    if (isAdminRole && clubName) {
      return `You've been invited to help run ${clubName} as ${roleName}. Tap here to get started: ${link}${appDownload}${emailNote}`;
    }
    if (selectedRole === "parent" && childrenNames.length === 1) {
      return `${childrenNames[0]} has been added to ${teamName || clubName || "the team"}${clubName && teamName ? ` at ${clubName}` : ""}!${appDownload}${emailNote}${link ? `\n\nJoin here: ${link}` : ""}`.trim();
    }
    if (selectedRole === "parent" && childrenNames.length > 1) {
      return `Your kids (${childrenNames.join(", ")}) have been added to ${teamName || clubName || "the team"}${clubName && teamName ? ` at ${clubName}` : ""}!${appDownload}${emailNote}${link ? `\n\nJoin here: ${link}` : ""}`.trim();
    }
    if (selectedRole === "parent" && teamName) {
      return `Your child has been added to ${teamName}${clubName ? ` at ${clubName}` : ""}!${appDownload}${emailNote}${link ? `\n\nJoin here: ${link}` : ""}`.trim();
    }
    if (teamName) {
      return `You've been added to ${teamName}${clubName ? ` at ${clubName}` : ""}! Tap here to join: ${link}${appDownload}${emailNote}`;
    }
    if (clubName) {
      return `You've been invited to join ${clubName}! Tap here to get started: ${link}${appDownload}${emailNote}`;
    }
    return `You've been invited to join the team! Tap here to get started: ${link}${appDownload}${emailNote}`;
  };

  const handleClose = () => {
    setOpen(false);
    setNameInput("");
    setNameConfirmed(false);
    setSelectedUser(null);
    setCustomEmail("");
    setSharePhone("");
    setDeliveryMethod("share");
    setSelectedRole(getDefaultRole());
    setInviteLink(null);
    setInviteShareLink(null);
    setInviteSent(false);
    setMode("single");
    setNameConfirmed(false);
    setSingleChildren([]);
    autoChildTriggered.current = false;
    setBulkMembers([{ id: crypto.randomUUID(), name: "", email: "", role: getDefaultRole(), children: [], selectedUser: null }]);
    setBulkResults([]);
    setCustomMessage("");
    setShowMessageEditor(false);
    setSecondParentName("");
    setSecondParentEmail("");
    setSecondParentSearch("");
    setSelectedSecondParent(null);
  };

  const handleDone = () => {
    handleClose();
  };

  const addBulkMemberRow = () => {
    setBulkMembers([...bulkMembers, { id: crypto.randomUUID(), name: "", email: "", role: selectedRole, children: [], selectedUser: null }]);
  };

  const removeBulkMemberRow = (id: string) => {
    if (bulkMembers.length > 1) {
      setBulkMembers(bulkMembers.filter(m => m.id !== id));
    }
  };

  const updateBulkMember = (id: string, field: keyof Omit<BulkMember, "id" | "children" | "selectedUser">, value: string) => {
    setBulkMembers(bulkMembers.map(m =>
      m.id === id
        ? { ...m, [field]: value, ...(field === "name" ? { selectedUser: null } : {}) }
        : m
    ));
  };

  const selectBulkExistingUser = (memberId: string, selected: { id: string; display_name: string | null; avatar_url: string | null }) => {
    setBulkMembers(bulkMembers.map(m =>
      m.id === memberId
        ? { ...m, name: selected.display_name || "", selectedUser: selected, email: "" }
        : m
    ));
  };

  const updateBulkMemberRole = (id: string, role: TeamRole) => {
    setBulkMembers(bulkMembers.map(m => m.id === id ? { ...m, role, children: role === "parent" ? m.children : [] } : m));
  };

  const addChildToMember = (memberId: string) => {
    setBulkMembers(bulkMembers.map(m =>
      m.id === memberId
        ? { ...m, children: [...m.children, { id: crypto.randomUUID(), name: "", yearOfBirth: "", jerseyNumber: "" }] }
        : m
    ));
  };

  const removeChildFromMember = (memberId: string, childId: string) => {
    setBulkMembers(bulkMembers.map(m =>
      m.id === memberId
        ? { ...m, children: m.children.filter(c => c.id !== childId) }
        : m
    ));
  };

  const updateChild = (memberId: string, childId: string, field: "name" | "yearOfBirth" | "jerseyNumber", value: string) => {
    setBulkMembers(bulkMembers.map(m =>
      m.id === memberId
        ? { ...m, children: m.children.map(c => {
            if (c.id !== childId) return c;
            const updated = { ...c, [field]: value };
            // Clear existing link when name changes (user must explicitly pick from search)
            if (field === "name") {
              updated.existingChildId = undefined;
              updated.existingChildParentName = undefined;
              updated.pendingInviteId = undefined;
              updated.pendingParentName = undefined;
              updated.confirmedNew = undefined;
            }
            return updated;
          }) }
        : m
    ));
  };

  const validBulkCount = bulkMembers.filter(m => m.name.trim()).length;
  // Any bulk row with a second-parent name but no valid email blocks the bulk add.
  const bulkSecondParentBlocked = bulkMembers.some(m => !!secondParentValidationError({
    role: m.role,
    name: m.secondParentName,
    email: m.secondParentEmail,
    selectedProfile: m.selectedSecondParent,
  }));

  const selectedRoleOption = roleOptions.find(r => r.value === selectedRole);

  // If we have bulk results, show bulk success state
  if (bulkResults.length > 0) {
    return (
      <AddTeamMemberBulkSuccessSheet
        open={open}
        onOpenChange={handleClose}
        onTriggerOpen={() => setOpen(true)}
        triggerVariant={triggerVariant}
        results={bulkResults}
        onAddMore={() => {
          setBulkResults([]);
          setBulkMembers([{ id: crypto.randomUUID(), name: "", email: "", role: getDefaultRole(), children: [] }]);
        }}
        onDone={handleDone}
        toast={toast}
      />
    );
  }

  // If we have a pending invite link (single mode), show success state
  if (inviteLink) {
    return (
      <AddTeamMemberInviteSuccessSheet
        open={open}
        onOpenChange={handleClose}
        onTriggerOpen={() => setOpen(true)}
        triggerVariant={triggerVariant}
        name={nameInput}
        selectedRole={selectedRole}
        children={singleChildren}
        teamName={teamName}
        clubName={clubBranding?.name}
        email={customEmail}
        sharePhone={sharePhone}
        onSharePhoneChange={setSharePhone}
        inviteLink={inviteShareLink || inviteLink}
        shareMessage={buildInviteShareMessage()}
        onAddAnother={() => {
          setInviteLink(null);
          setInviteShareLink(null);
          setNameInput("");
          setNameConfirmed(false);
          setCustomEmail("");
          setSharePhone("");
          setDeliveryMethod("share");
          setSingleChildren([]);
          setSecondParentName("");
          setSecondParentEmail("");
          setSecondParentSearch("");
          setSelectedSecondParent(null);
          setCustomMessage("");
          setShowMessageEditor(false);
        }}
        onDone={handleDone}
        toast={toast}
      />
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {triggerVariant !== "none" && (
        <SheetTrigger asChild>
          {triggerVariant === "icon" ? (
            <Button variant="ghost" size="icon" className="h-9 w-9" data-invite-trigger onClick={() => setOpen(true)}>
              <UserPlus className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="sm" data-invite-trigger onClick={() => setOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Invite to Team
            </Button>
          )}
        </SheetTrigger>
      )}
      <SheetContent
        side="bottom"
        enableDragToClose
        hideCloseButton
        className="rounded-t-2xl flex flex-col overflow-hidden overscroll-contain"
        data-lock-keyboard-scroll="true"
        data-allow-scroll
        style={{
          touchAction: 'pan-y',
          WebkitOverflowScrolling: 'touch',
          // When the soft keyboard is open (Capacitor Keyboard.resize='none'),
          // lift the sheet ABOVE the keyboard by offsetting its bottom edge.
          bottom: nativeKbHeight > 0 ? `${nativeKbHeight}px` : undefined,
          // STABLE HEIGHT: the sheet keeps ONE height for the whole invite
          // workflow so it never grows/shrinks (and visibly jolts) as steps
          // change or as validation rows/errors appear while typing. Only the
          // keyboard inset changes it; all content scrolls inside.
          // `--visual-vh` is the monotonic-max locked viewport height.
          height: `calc(min(86vh, calc(var(--visual-vh, 100dvh) * 0.86)) - ${nativeKbHeight}px)`,
          maxHeight: `calc(var(--visual-vh, 100dvh) - ${nativeKbHeight}px - env(safe-area-inset-top, 0px) - 8px)`,
          // Only animate the keyboard lift — never height, so content changes
          // cannot produce an animated up/down jolt.
          transitionProperty: 'bottom',
          transitionDuration: '200ms',
          transitionTimingFunction: 'ease',
        }}

      >
        <SheetHeader className="mb-3 shrink-0 relative pr-2">
          <SheetTitle>Invite to Team</SheetTitle>
          <SheetDescription>
            Add players, parents or coaches
          </SheetDescription>
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute -right-1 top-0 h-8 w-8 rounded-full opacity-70 hover:opacity-100"
              aria-label="Close invite sheet"
            >
              <X className="h-4 w-4" />
            </Button>
          </SheetClose>
        </SheetHeader>

        <div data-allow-scroll className="flex-1 overflow-y-auto min-h-0 -mx-6 px-6 pb-4 overscroll-contain" style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "single" | "bulk")} className="w-full">
          {/* Multiple/bulk tab removed — join link + single invite cover all cases */}

          <TabsContent value="single" className="space-y-4 mt-0">

            {/* Share link — visible the moment the sheet opens; auto-created
                for the default role so Copy/Share need zero extra taps. */}
            {canBulkInvite && !nameInput.trim() && !selectedUser && (
              <>
                <TeamJoinLinkCard
                  teamId={teamId}
                  teamName={teamName}
                  teamType={teamType}
                  autoCreateLink
                />
                <div className="flex items-center gap-3 pt-1">
                  <div className="h-px flex-1 bg-border" />
                  <p className="text-xs font-medium text-muted-foreground">Or invite a specific person</p>
                  <div className="h-px flex-1 bg-border" />
                </div>
              </>
            )}

            {/* Invite-by-name body — always visible below the share link */}
            {inviteByNameOpen && (
              <>

            {/* Person — name input, search, existing user / new member chip */}
              <>
            {/* 2. NAME INPUT */}
            {!selectedUser && !nameConfirmed ? (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Name</Label>

                <div className="relative flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name or email, or enter new"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      className="pl-10 h-12 text-base"
                      onPaste={(e) => {
                        const text = e.clipboardData.getData("text");
                        if (!looksLikeMultiRecipient(text)) return;
                        e.preventDefault();
                        const recipients = parseRecipients(text);
                        if (recipients.length < 2) return;
                        setBulkMembers(recipients.map((r) => ({
                          id: crypto.randomUUID(),
                          name: r.name,
                          email: r.email,
                          role: getDefaultRole(),
                          children: [],
                          selectedUser: null,
                        })));
                        setMode("bulk");
                        toast({
                          title: `${recipients.length} recipients detected`,
                          description: "Switched to multi-invite. Review the list and send.",
                        });
                      }}
                      onFocus={(e) => {
                        // On iOS the soft keyboard covers the input because the
                        // sheet sits above the keyboard but the input is below
                        // the role selector. Scroll the field into view once the
                        // keyboard has begun to animate up.
                        const el = e.currentTarget;
                        setTimeout(() => {
                          try {
                            el.scrollIntoView({ behavior: "smooth", block: "center" });
                          } catch {}
                        }, 250);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && nameInput.trim()) {
                          setNameConfirmed(true);
                        }
                      }}
                    />
                  </div>
                  {nameInput.trim() && (
                    <Button
                      type="button"
                      size="icon"
                      className="h-12 w-12 shrink-0"
                      onClick={() => setNameConfirmed(true)}
                    >
                      <Check className="h-5 w-5" />
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">You can paste multiple names.</p>

                {isSearching && (
                  <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </div>
                )}

                {!isSearching && (filteredResults.length > 0 || filteredPendingResults.length > 0) && debouncedNameInput.length >= 2 && (
                  <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border bg-muted/30 p-2">
                    {filteredResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => {
                          setSelectedUser(result);
                          setNameInput("");
                        }}
                        className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-background transition-colors text-left"
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={result.avatar_url || undefined} />
                          <AvatarFallback className="bg-primary/20 text-primary text-sm">
                            {result.display_name?.[0]?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium truncate">{result.display_name || "Unknown"}</span>
                          {existingMembers?.includes(result.id) && (
                            <span className="text-[11px] text-muted-foreground truncate">
                              Already on this team — pick to add a child
                            </span>
                          )}
                          {identityMap[result.id]?.contextLine && (
                            <span className="text-xs text-muted-foreground truncate">{identityMap[result.id].contextLine}</span>
                          )}

                          {(result as any).masked_email && (
                            <span className="text-[11px] text-muted-foreground/70 truncate">{(result as any).masked_email}</span>
                          )}
                        </div>
                      </button>
                    ))}
                    {filteredPendingResults.map((result) => (
                      <button
                        key={result.pendingInviteId}
                        type="button"
                        onClick={() => {
                          if (result.id.startsWith("pending-")) {
                            setNameInput(result.display_name || "");
                            if (result.invited_email) {
                              setCustomEmail(result.invited_email);
                            }
                          } else {
                            setSelectedUser({
                              id: result.id,
                              display_name: result.display_name,
                              avatar_url: result.avatar_url,
                            });
                            setNameInput("");
                          }
                        }}
                        className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-background transition-colors text-left"
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={result.avatar_url || undefined} />
                          <AvatarFallback className="bg-amber-500/20 text-amber-600 dark:text-amber-400 text-sm">
                            {result.display_name?.[0]?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium truncate">{result.display_name || "Unknown"}</span>
                          <span className="text-xs text-muted-foreground truncate">
                            {formatPendingInviteSubtitle(result.role, result.teamName, result.childName)}
                          </span>
                        </div>
                      </button>
                    ))}
                    <p className="text-xs text-muted-foreground px-2 pt-1">
                      Or continue typing to add as a new member
                    </p>
                  </div>
                )}

                {!isSearching && debouncedNameInput.length >= 2 && filteredResults.length === 0 && filteredPendingResults.length === 0 && (
                  <p className="text-xs text-muted-foreground py-1">
                    No existing users found — will be invited as new member
                  </p>
                )}

                {selectedRole !== "parent" && memberNameMatchesExisting(nameInput) && (
                  <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      <strong>{memberNameMatchesExisting(nameInput)?.display_name}</strong> is already on this team.
                    </p>
                  </div>
                )}
              </div>
            ) : !selectedUser && nameConfirmed ? (
              /* Confirmed new member name chip */
              <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary/20 text-primary">
                    {nameInput.trim()[0]?.toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="font-medium">{nameInput.trim()}</p>
                  <p className="text-sm text-muted-foreground">New member</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setNameConfirmed(false)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              /* Selected user chip */
              <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={selectedUser!.avatar_url || undefined} />
                  <AvatarFallback className="bg-primary/20 text-primary">
                    {selectedUser!.display_name?.[0]?.toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="font-medium">{selectedUser!.display_name || "Unknown"}</p>
                  <p className="text-sm text-muted-foreground">Will be added directly</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSelectedUser(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
              </>

            {/* Role selection — disclosed as soon as a person is chosen/typed */}
            {personReady && (
              <div className="space-y-2 scroll-mt-4" ref={roleSectionRef}>
                <Label className="text-sm font-medium">Select role</Label>
                <div className={`grid gap-2 ${roleOptions.length <= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {roleOptions.map((opt) => (
                    <button
                      key={`top-${opt.value}`}
                      type="button"
                      role="radio"
                      aria-checked={selectedRole === opt.value}
                      aria-pressed={selectedRole === opt.value}
                      aria-label={`Role: ${opt.label}`}
                      onClick={() => setSelectedRole(opt.value)}
                      className={`p-3 rounded-xl text-center transition-all border ${
                        selectedRole === opt.value
                          ? "border-primary bg-primary text-primary-foreground shadow-sm"
                          : "border-border bg-muted/40 hover:bg-muted text-foreground"
                      }`}
                    >
                      <p className="text-sm font-medium">
                        {opt.value === "parent" ? "Parent" : opt.value === "coach" ? "Coach" : opt.value === "team_admin" ? "Admin" : opt.label}
                      </p>
                      {opt.value === "parent" && (
                        <p className={`text-[11px] mt-0.5 ${selectedRole === opt.value ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                          adds child player
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Existing user, non-parent: optional email to send invite email */}
            {selectedUser && selectedRole !== "parent" && (
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />
                  Email address (optional — to send invite email)
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="e.g., redacted@example.invalid"
                    value={customEmail}
                    onChange={(e) => setCustomEmail(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            )}

            {/* Existing user, parent role: child fields + second guardian (inline) */}
            {selectedUser && selectedRole === "parent" && (
              <ChildAndSecondGuardianFields
                singleChildren={singleChildren}
                setSingleChildren={setSingleChildren}
                findMatchingChildren={findMatchingChildren}
                clubChildren={clubChildren}
                selectedSecondParent={selectedSecondParent}
                setSelectedSecondParent={setSelectedSecondParent}
                secondParentSearch={secondParentSearch}
                setSecondParentSearch={setSecondParentSearch}
                secondParentName={secondParentName}
                setSecondParentName={setSecondParentName}
                secondParentEmail={secondParentEmail}
                setSecondParentEmail={setSecondParentEmail}
                filteredSecondParentResults={filteredSecondParentResults}
                secondParentJoinDescription="Will be added directly"
              />
            )}

            {/* New member, parent role: child fields + second guardian (inline) */}
            {!selectedUser && personReady && selectedRole === "parent" && (
              <ChildAndSecondGuardianFields
                singleChildren={singleChildren}
                setSingleChildren={setSingleChildren}
                findMatchingChildren={findMatchingChildren}
                clubChildren={clubChildren}
                selectedSecondParent={selectedSecondParent}
                setSelectedSecondParent={setSelectedSecondParent}
                secondParentSearch={secondParentSearch}
                setSecondParentSearch={setSecondParentSearch}
                secondParentName={secondParentName}
                setSecondParentName={setSecondParentName}
                secondParentEmail={secondParentEmail}
                setSecondParentEmail={setSecondParentEmail}
                filteredSecondParentResults={filteredSecondParentResults}
                secondParentJoinDescription="Joins team immediately"
              />
            )}

            {/* Delivery method + custom message (new members only) */}
            {!selectedUser && personReady && (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">How to deliver invite?</Label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setDeliveryMethod("email"); }}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                        deliveryMethod === "email"
                          ? "bg-primary/10 border-primary text-primary"
                          : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50"
                      }`}
                    >
                      <Mail className="h-4 w-4" />
                      Email
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDeliveryMethod("share"); setCustomEmail(""); }}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                        deliveryMethod === "share"
                          ? "bg-primary/10 border-primary text-primary"
                          : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50"
                      }`}
                    >
                      <Share2 className="h-4 w-4" />
                      Share Link
                    </button>
                  </div>
                  {deliveryMethod === "email" ? (
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="email"
                        placeholder="e.g., redacted@example.invalid"
                        value={customEmail}
                        onChange={(e) => setCustomEmail(e.target.value)}
                        className="pl-10"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No email needed — tap <strong>Create Invite</strong> and you'll get a link to share or copy.
                    </p>
                  )}

                </div>

                {/* Custom message toggle */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5 text-sm">
                      <MessageSquare className="h-3.5 w-3.5" />
                      Custom Message
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        setShowMessageEditor(!showMessageEditor);
                      }}
                    >
                      {showMessageEditor ? "Hide" : "Add message"}
                    </Button>
                  </div>
                  {showMessageEditor && (
                    <Textarea
                      placeholder={`Add a personal note (optional). Example:\n\nHi! We're using Ignite Club HQ to keep everything organised — fixtures, chat, and team updates all in one place. Tap the link to join.`}
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      rows={4}
                      className="text-sm resize-none"
                    />
                  )}
                </div>
              </>
            )}
              </>
            )}
          </TabsContent>

          <TabsContent value="bulk" className="space-y-4 mt-0">
            {/* Role Selection for bulk mode */}
            <div className="space-y-2 mb-2">
              <Label className="text-sm font-medium">Default role</Label>
              <div className={`grid gap-2 ${roleOptions.length <= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {roleOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedRole(opt.value)}
                    className={`p-2.5 rounded-xl text-center transition-all border ${
                      selectedRole === opt.value
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-muted/40 hover:bg-muted text-foreground"
                    }`}
                  >
                    <p className="text-sm font-medium">
                      {opt.value === "parent" ? "Parent" : opt.value === "coach" ? "Coach" : opt.value === "team_admin" ? "Admin" : opt.label}
                    </p>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Add multiple members at once. Email addresses are optional.
              </p>

              {/* Contextual hint for parent role */}
              {(selectedRole === "parent" || bulkMembers.some(m => m.role === "parent")) && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Baby className="h-3.5 w-3.5 text-primary" />
                  Add child details under each parent row
                </p>
              )}

              {/* CSV Import */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setCsvImportOpen(true)}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Import CSV
                </Button>
                <Button variant="outline" className="flex-1" onClick={addBulkMemberRow}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Row
                </Button>
              </div>

              {csvImportOpen && <Suspense fallback={null}><MemberCSVImportDialog
                open={csvImportOpen}
                onOpenChange={setCsvImportOpen}
                defaultRole={selectedRole}
                onImport={(members) => {
                  // Convert members to the expected format and auto-trigger invites
                  const formattedMembers: BulkMember[] = members.map(m => ({
                    ...m,
                    children: m.children.map(child => {
                      const match = findMatchingChildren(child.name)[0] || null;
                      return {
                        id: crypto.randomUUID(),
                        name: child.name,
                        yearOfBirth: child.yearOfBirth ? String(child.yearOfBirth) : "",
                        jerseyNumber: child.shirtNumber ? String(child.shirtNumber) : "",
                        existingChildId: match && !(match as any).isPending ? match.id : undefined,
                        existingChildParentName: match && !(match as any).isPending ? match.parent_name : undefined,
                        pendingInviteId: (match as any)?.isPending ? (match as any).inviteId : undefined,
                        pendingParentName: (match as any)?.isPending ? match.parent_name : undefined,
                        confirmedNew: (match as any)?.isPending ? true : undefined,
                      };
                    }),
                  }));
                  // Pass members directly to mutation to avoid state timing issues
                  addBulkMembersMutation.mutate(formattedMembers);
                }}
              /></Suspense>}
            </div>

            <AddTeamMemberBulkMemberList
              bulkMembers={bulkMembers}
              roleOptions={roleOptions}
              bulkSearchMap={bulkSearchMap}
              bulkSecondParentMap={bulkSecondParentMap}
              memberNameMatchesExisting={memberNameMatchesExisting}
              findMatchingChildren={findMatchingChildren}
              setBulkMembers={setBulkMembers}
              updateBulkMember={updateBulkMember}
              selectBulkExistingUser={selectBulkExistingUser}
              updateBulkMemberRole={updateBulkMemberRole}
              addChildToMember={addChildToMember}
              removeChildFromMember={removeChildFromMember}
              updateChild={updateChild}
              removeBulkMemberRow={removeBulkMemberRow}
            />

            {/* Custom message for bulk invites */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Custom Message
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setShowMessageEditor(!showMessageEditor);
                  }}
                >
                  {showMessageEditor ? "Hide" : "Add message"}
                </Button>
              </div>
              {showMessageEditor && (
                <div className="space-y-1.5">
                  <Textarea
                    placeholder={`Add a personal note (optional). Example:\n\nHi! We're using Ignite Club HQ to keep everything organised — fixtures, chat, and team updates all in one place. Tap the link to join.`}
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    rows={4}
                    className="text-sm resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    This message will appear in all invite emails
                  </p>
                </div>
              )}
            </div>

          </TabsContent>
        </Tabs>
        </div>

        {/* Sticky CTA footer — hidden entirely when invite-by-name is collapsed */}
        {(mode !== "single" || inviteByNameOpen) && (
        <div data-allow-scroll className="shrink-0 border-t bg-background px-6 py-4 -mx-6 -mb-6" style={{ touchAction: 'pan-y' }}>
          {mode === "single" ? (() => {
            // When invite-by-name is collapsed (initial state), the bottom
            // CTA shouldn't render at all — the join-link card is the
            // primary action and has its own buttons.
            if (!inviteByNameOpen) return null;
            // Single-screen flow: one primary action, validated as a whole.
            const isPending = addExistingUserMutation.isPending || addPendingMemberMutation.isPending;
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const emailTrimmed = customEmail.trim();
            const parentNeedsChild =
              selectedRole === "parent" && !singleChildren.some((c) => c.name.trim().length > 0);
            const submitNeedsEmail =
              !selectedUser && deliveryMethod === "email" && !emailTrimmed;
            const submitInvalidEmail =
              !selectedUser && deliveryMethod === "email" && !!emailTrimmed && !emailRegex.test(emailTrimmed);
            // A second-parent name without a valid email must block submission —
            // it must never be silently discarded.
            const secondParentBlocked = secondParentValidationError({
              role: selectedRole,
              name: secondParentName,
              email: secondParentEmail,
              selectedProfile: selectedSecondParent,
            });

            // Guardrail: human-readable reason explaining why the primary
            // action is currently blocked. Surfaced inline above the footer
            // button so users aren't left guessing why it's greyed out.
            let blockedReason: string | null = null;
            if (!personReady) {
              // Don't show a yellow warning on the empty initial state —
              // the disabled CTA below already communicates what's needed.
              blockedReason = null;
            } else if (parentNeedsChild) {
              blockedReason = "Add at least one child's name to continue.";
            } else if (submitNeedsEmail) {
              blockedReason = "Enter an email address to send the invite.";
            } else if (submitInvalidEmail) {
              blockedReason = "That email doesn't look right — double-check the format.";
            } else if (secondParentBlocked) {
              blockedReason = secondParentBlocked;
            }

            const submitBlocked =
              !personReady || parentNeedsChild || submitNeedsEmail || submitInvalidEmail || !!secondParentBlocked;

            const handleSubmit = () => {
              if (submitBlocked || isPending) return;
              // Stamp the name as confirmed so the chip view stays consistent
              // if the mutation errors and the sheet remains open.
              if (!selectedUser && !nameConfirmed) setNameConfirmed(true);
              if (selectedUser) addExistingUserMutation.mutate();
              else addPendingMemberMutation.mutate();
            };

            const ctaLabel = !personReady
              ? "Enter a name to continue"
              : parentNeedsChild
                ? "Add a child to continue"
                : selectedUser
                  ? "Add to Team"
                  : deliveryMethod === "email"
                    ? "Send Invite"
                    : "Create Invite";

            return (
              <div className="space-y-2">
                {blockedReason && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{blockedReason}</span>
                  </div>
                )}
                <Button
                  className="w-full h-12 text-base font-semibold"
                  onClick={handleSubmit}
                  disabled={isPending || submitBlocked}
                  variant={submitBlocked ? "outline" : "default"}
                >
                  {isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  ) : (
                    <UserPlus className="h-5 w-5 mr-2" />
                  )}
                  {ctaLabel}
                </Button>
              </div>
            );
          })() : (
            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={() => addBulkMembersMutation.mutate(undefined)}
              disabled={validBulkCount === 0 || bulkSecondParentBlocked || addBulkMembersMutation.isPending}
            >
              {addBulkMembersMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <Send className="h-5 w-5 mr-2" />
              )}
              {validBulkCount > 0
                ? `Add ${validBulkCount} Member${validBulkCount > 1 ? "s" : ""}`
                : "Enter names to continue"}
            </Button>
          )}
        </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
