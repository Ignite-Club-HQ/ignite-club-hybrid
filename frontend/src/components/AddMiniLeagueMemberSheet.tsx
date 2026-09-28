import { useState, useEffect, useRef, Suspense, type CSSProperties } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Loader2, X, Send, Plus, Upload, ChevronUp, Check } from "lucide-react";
const MiniLeagueMemberCSVImportDialog = lazyWithRetry(() => import("@/components/MiniLeagueMemberCSVImportDialog").then(m => ({ default: m.MiniLeagueMemberCSVImportDialog })));
import MiniLeagueParentJoinLinkCard from "@/components/mini-league/MiniLeagueParentJoinLinkCard";
import { parseRecipients, looksLikeMultiRecipient } from "@/components/invite/recipientParser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import type { Database, Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";
import { useToast } from "@/hooks/use-toast";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import {
  ParentInviteFields,
  type ParentInviteSuggestion,
} from "@/components/membership/ParentInviteFields";

interface BulkPlayer {
  id: string;
  name: string;
  abilityRating: string;
  parentName: string;
  parentEmail: string;
  existingChildId?: string;
  existingParentUserId?: string;
}

interface AddMiniLeagueMemberSheetProps {
  miniLeagueId: string;
  miniLeagueName: string;
  clubId: string;
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}

type ExistingChildRow = {
  id: string;
  name: string;
  parent_id: string | null;
};

const abilityOptions = [
  { value: "", label: "Not specified" },
  { value: "1", label: "1 - Beginner" },
  { value: "2", label: "2 - Developing" },
  { value: "3", label: "3 - Intermediate" },
  { value: "4", label: "4 - Advanced" },
  { value: "5", label: "5 - Expert" },
];

const createEmptyPlayer = (): BulkPlayer => ({
  id: crypto.randomUUID(),
  name: "",
  abilityRating: "",
  parentName: "",
  parentEmail: "",
});

export function AddMiniLeagueMemberSheet({ miniLeagueId, miniLeagueName, clubId, externalOpen, onExternalOpenChange }: AddMiniLeagueMemberSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const nativeKeyboardHeight = useNativeKeyboardHeight();
  const [internalOpen, setInternalOpen] = useState(false);
  const isExternallyControlled = externalOpen !== undefined;
  const open = isExternallyControlled ? externalOpen : internalOpen;
  const setOpen = (val: boolean) => {
    if (isExternallyControlled) {
      onExternalOpenChange?.(val);
    } else {
      setInternalOpen(val);
    }
  };

  const [players, setPlayers] = useState<BulkPlayer[]>([createEmptyPlayer()]);
  const [results, setResults] = useState<{ playerName: string; parentEmail: string; sent: boolean }[]>([]);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [inviteByNameExpanded, setInviteByNameExpanded] = useState(false);
  const [activeSearch, setActiveSearch] = useState<{ rowId: string; field: "name" | "parentName" } | null>(null);
  const [parentQuery, setParentQuery] = useState("");
  const [debouncedParentQuery, setDebouncedParentQuery] = useState("");
  const [visualKeyboardInset, setVisualKeyboardInset] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const focusedInputRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedParentQuery(parentQuery), 250);
    return () => clearTimeout(t);
  }, [parentQuery]);

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      setVisualKeyboardInset(0);
      return;
    }

    let rafId: number | null = null;
    let lastInset = -1;
    const syncKeyboardInset = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        const viewport = window.visualViewport;
        if (!viewport) {
          if (lastInset !== 0) {
            lastInset = 0;
            setVisualKeyboardInset(0);
          }
          return;
        }
        const inset = Math.round(
          Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        );
        // Ignore sub-pixel jitter (Android keyboard animation pings the
        // visualViewport repeatedly during open/close → re-render flash).
        if (Math.abs(inset - lastInset) < 2) return;
        lastInset = inset;
        setVisualKeyboardInset(inset);
      });
    };

    syncKeyboardInset();
    window.visualViewport?.addEventListener("resize", syncKeyboardInset);
    window.visualViewport?.addEventListener("scroll", syncKeyboardInset);
    window.addEventListener("resize", syncKeyboardInset);

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.visualViewport?.removeEventListener("resize", syncKeyboardInset);
      window.visualViewport?.removeEventListener("scroll", syncKeyboardInset);
      window.removeEventListener("resize", syncKeyboardInset);
    };
  }, [open]);


  const { data: clubBranding } = useQuery({
    queryKey: ["club-branding", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("name, logo_url, contact_email")
        .eq("id", clubId)
        .single();
      return data;
    },
    enabled: !!clubId,
  });

  // Fetch existing children in this club for player name search
  const { data: clubChildren = [] } = useQuery({
    queryKey: ["mini-league-club-children", clubId],
    queryFn: async () => {
      const { data: teamIds } = await supabase
        .from("teams")
        .select("id")
        .eq("club_id", clubId);

      const childIds = new Set<string>();
      if (teamIds?.length) {
        const { data: assignments } = await supabase
          .from("child_team_assignments")
          .select("child_id")
          .in("team_id", teamIds.map(t => t.id));
        assignments?.forEach(a => childIds.add(a.child_id));
      }

      const { data: clubParents } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", clubId)
        .eq("role", "parent");
      const parentUserIds = [...new Set(clubParents?.map(p => p.user_id) || [])];
      if (parentUserIds.length) {
        const { data: parentChildren } = await supabase
          .from("children")
          .select("id")
          .in("parent_id", parentUserIds);
        parentChildren?.forEach(c => childIds.add(c.id));
      }

      if (!childIds.size) return [];
      const { data: children } = await supabase
        .from("children")
        .select("id, name, parent_id")
        .in("id", [...childIds]);
      if (!children?.length) return [];

      const childRows = children as ExistingChildRow[];
      const parentIds = [...new Set(
        childRows
          .map(c => c.parent_id)
          .filter((parentId): parentId is string => Boolean(parentId)),
      )];
      const { data: parents } = await selectCachedProfilesByIds(parentIds);
      const parentMap = new Map(parents?.map(p => [p.id, p.display_name]) || []);

      return childRows.map(c => ({
        id: c.id,
        name: c.name,
        parent_id: c.parent_id,
        parent_name: c.parent_id ? parentMap.get(c.parent_id) || "" : "",
      }));
    },
    enabled: open && inviteByNameExpanded && !!clubId,
  });

  // Search invitable parents
  const { data: parentResults = [] } = useQuery({
    queryKey: ["mini-league-parent-search", debouncedParentQuery, clubId],
    queryFn: async () => {
      if (debouncedParentQuery.trim().length < 2) return [];
      const { data } = await supabase.rpc("search_invitable_profiles", {
        _query: debouncedParentQuery.trim(),
        _limit: 6,
        _club_id: clubId ?? null,
      });
      const profiles = (data || []) as Array<{
        id: string;
        display_name: string | null;
        masked_email: string | null;
      }>;
      if (!profiles.length || !clubId) {
        return profiles.map((p) => ({ ...p, roles: [] as string[] }));
      }
      // Enrich with roles within this club so admins can disambiguate
      const ids = profiles.map((p) => p.id);
      const [directRolesRes, teamRolesRes] = await Promise.all([
        supabase
          .from("user_roles")
          .select("user_id, role")
          .in("user_id", ids)
          .eq("club_id", clubId),
        supabase
          .from("user_roles")
          .select("user_id, role, teams!inner(club_id)")
          .in("user_id", ids)
          .eq("teams.club_id", clubId),
      ]);
      const roleMap = new Map<string, Set<string>>();
      const pushRole = (uid: string, role: string | null) => {
        if (!role) return;
        if (!roleMap.has(uid)) roleMap.set(uid, new Set());
        roleMap.get(uid)!.add(String(role).replace(/_/g, " "));
      };
      (directRolesRes.data || []).forEach((r: any) => pushRole(r.user_id, r.role));
      (teamRolesRes.data || []).forEach((r: any) => pushRole(r.user_id, r.role));
      return profiles.map((p) => ({
        ...p,
        roles: Array.from(roleMap.get(p.id) || []),
      }));
    },
    enabled: debouncedParentQuery.trim().length >= 2,
  });

  const handleClose = () => {
    setOpen(false);
    setPlayers([createEmptyPlayer()]);
    setResults([]);
    setInviteByNameExpanded(false);
    setActiveSearch(null);
    setParentQuery("");
  };

  const addPlayersMutation = useMutation({
    mutationFn: async (playersToAdd?: BulkPlayer[]) => {
      const playersSource = playersToAdd || players;
      const validPlayers = playersSource.filter((player) => player.name.trim());
      if (validPlayers.length === 0) throw new Error("Please enter at least one player");

      const missingParent = validPlayers.find((p) => !p.parentName.trim());
      if (missingParent) throw new Error(`Enter a parent name for ${missingParent.name.trim()}`);
      const missingEmail = validPlayers.find((p) => !p.existingParentUserId && !p.parentEmail.trim());
      if (missingEmail) throw new Error(`Enter a parent email for ${missingEmail.name.trim()} so they can be invited`);
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmail = validPlayers.find((p) => !p.existingParentUserId && !emailRe.test(p.parentEmail.trim()));
      if (invalidEmail) throw new Error(`Enter a valid parent email for ${invalidEmail.name.trim()}`);

      const addedResults: { playerName: string; parentEmail: string; sent: boolean }[] = [];

      for (const player of validPlayers) {
        let childId = player.existingChildId;

        if (!childId) {
          // Pre-generate the id so we don't need to read the row back
          // (reading back requires SELECT visibility on the new child,
          // which an admin may not have until the league assignment exists)
          const newChildId = crypto.randomUUID();
          const { error: childError } = await supabase
            .from("children")
            .insert({
              id: newChildId,
              // Only attach parent_id if a real parent account exists. Otherwise
              // leave NULL until the parent claims their invite — never fall back
              // to the inviter, or the league admin becomes the legal parent.
              parent_id: player.existingParentUserId || null,
              name: player.name.trim(),
            });

          if (childError) {
            console.error("Failed to create child:", player.name, childError);
            throw new Error(`Couldn't add ${player.name}: ${childError.message}`);
          }
          childId = newChildId;
        }

        const abilityRatingValue = player.abilityRating ? parseInt(player.abilityRating) : null;

        const { error: assignmentError } = await supabase
          .from("child_mini_league_assignments")
          .insert({
            child_id: childId!,
            mini_league_id: miniLeagueId,
            ability_rating: abilityRatingValue,
          });

        if (assignmentError) {
          console.error("Failed to create league assignment:", player.name, assignmentError);
          throw new Error(`Couldn't assign ${player.name}: ${assignmentError.message}`);
        }

        const { data: newPlayer, error: playerError } = await supabase
          .from("mini_league_players")
          .insert({
            mini_league_id: miniLeagueId,
            name: player.name.trim(),
            ability_rating: abilityRatingValue,
            child_id: childId!,
            parent_user_id: player.existingParentUserId || null,
          })
          .select()
          .single();

        if (playerError) {
          console.warn("Failed to create legacy player record:", player.name, playerError);
        }

        let sent = false;

        if (player.parentEmail.trim() && !player.existingParentUserId) {
          const inviteToken = crypto.randomUUID();
          const inviteMetadata: Json = {
            mini_league_id: miniLeagueId,
            child_id: childId,
            player_id: newPlayer?.id,
            player_name: player.name.trim(),
            children: [{ name: player.name.trim(), yearOfBirth: null }],
          };
          const invitePayload: Database["public"]["Tables"]["pending_invites"]["Insert"] = {
            club_id: clubId,
            role: "parent",
            invited_user_id: null,
            invited_by_user_id: user!.id,
            invited_label: player.parentName.trim() || player.parentEmail.trim(),
            invited_email: player.parentEmail.trim().toLowerCase(),
            invite_token: inviteToken,
            metadata: inviteMetadata,
          };
          const { error: inviteError } = await supabase.from("pending_invites").insert(invitePayload);

          if (!inviteError) {
            try {
              const link = `${window.location.origin}/join/p/${inviteToken}`;
              const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
                body: {
                  to: player.parentEmail.trim(),
                  subject: `You're invited to ${miniLeagueName}`,
                  template: "team-invite",
                  senderName: clubBranding?.name || undefined,
                  replyTo: clubBranding?.contact_email || undefined,
                  templateData: {
                    recipientName: player.parentName.trim() || player.parentEmail.trim(),
                    teamName: miniLeagueName,
                    clubName: clubBranding?.name || "The Club",
                    roleName: "Parent",
                    inviteLink: link,
                    clubLogoUrl: clubBranding?.logo_url || undefined,
                    childrenNames: [player.name.trim()],
                    isMiniLeague: true,
                  },
                },
              });

              sent = !funcError && emailResult?.verified && emailResult?.success;

              await supabase
                .from("pending_invites")
                .update({
                  email_sent_at: sent ? new Date().toISOString() : null,
                  email_id: emailResult?.emailId || null,
                  email_error: funcError?.message || (!sent ? "Email not verified" : null),
                } satisfies Database["public"]["Tables"]["pending_invites"]["Update"])
                .eq("invite_token", inviteToken);
            } catch (error) {
              console.error("Failed to send email:", error);
            }
          }
        }

        addedResults.push({
          playerName: player.name.trim(),
          parentEmail: player.parentEmail.trim(),
          sent,
        });
      }

      return addedResults;
    },
    onSuccess: (addedResults) => {
      setResults(addedResults);
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });

      const sentCount = addedResults.filter((result) => result.sent).length;
      const totalCount = addedResults.length;

      toast({
        title: `${totalCount} player${totalCount > 1 ? "s" : ""} added`,
        description: sentCount > 0
          ? `${sentCount} invite${sentCount > 1 ? "s" : ""} sent`
          : "Players added to the league",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add players",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const addRow = () => {
    setPlayers((current) => [...current, createEmptyPlayer()]);
  };

  const removeRow = (id: string) => {
    if (players.length <= 1) return;
    setPlayers((current) => current.filter((player) => player.id !== id));
  };

  const updatePlayer = (id: string, patch: Partial<BulkPlayer>) => {
    setPlayers((current) => current.map((player) => player.id === id ? { ...player, ...patch } : player));
  };

  const handlePastePlayers = (text: string) => {
    if (!looksLikeMultiRecipient(text)) return false;
    const recipients = parseRecipients(text);
    if (recipients.length < 2) return false;

    setPlayers(recipients.map((recipient) => ({
      id: crypto.randomUUID(),
      name: recipient.name,
      abilityRating: "",
      parentName: "",
      parentEmail: recipient.email,
    })));
    toast({
      title: `${recipients.length} players detected`,
      description: "Review and add.",
    });
    return true;
  };

  const handleCSVImport = (importedPlayers: BulkPlayer[]) => {
    addPlayersMutation.mutate(importedPlayers);
  };

  const isPending = addPlayersMutation.isPending;

  const childMatchesFor = (q: string) => {
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    return clubChildren.filter(c => c.name?.toLowerCase().includes(query)).slice(0, 6);
  };

  const scrollFocusedInputIntoView = (element: HTMLElement | null) => {
    const target = element ?? focusedInputRef.current;
    const container = scrollContainerRef.current;
    if (!target || !container) return;

    const inputRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const keyboardTop = window.visualViewport
      ? window.visualViewport.offsetTop + window.visualViewport.height
      : window.innerHeight;
    const visibleBottom = Math.min(containerRect.bottom, keyboardTop) - 24;

    if (inputRect.bottom > visibleBottom) {
      container.scrollBy({ top: inputRect.bottom - visibleBottom, behavior: "smooth" });
    }
  };

  const keepFocusedInputVisible = (element: HTMLElement) => {
    focusedInputRef.current = element;
    // Multiple attempts because Android keyboard + viewport resize can take
    // several hundred ms after focus before the visible area stabilises.
    [60, 220, 450, 750].forEach((delay) => {
      window.setTimeout(() => {
        if (focusedInputRef.current === element) scrollFocusedInputIntoView(element);
      }, delay);
    });
  };

  // Re-scroll the focused input back into view whenever the keyboard
  // inset changes (e.g. Android viewport resize, iOS visualViewport).
  useEffect(() => {
    if (!focusedInputRef.current) return;
    const id = window.setTimeout(() => scrollFocusedInputIntoView(null), 50);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualKeyboardInset, nativeKeyboardHeight]);

  const activePlayer = activeSearch ? players.find((player) => player.id === activeSearch.rowId) : undefined;
  const activeChildSuggestions = activeSearch?.field === "name" && activePlayer && !activePlayer.existingChildId
    ? childMatchesFor(activePlayer.name)
    : [];
  const activeParentSuggestions = activeSearch?.field === "parentName" && activePlayer && !activePlayer.existingParentUserId
    ? parentResults
    : [];
  // Use ONLY visualViewport inset for layout. On Android the WebView resizes
  // (so visualKeyboardInset ≈ 0 and 100dvh already excludes the keyboard); on
  // iOS visualViewport correctly reports the keyboard overlap. Mixing in the
  // Capacitor nativeKeyboardHeight here caused double-compensation — the sheet
  // both shrunk and shifted up by ~300px, producing the focus flash/jump.
  const keyboardInset = visualKeyboardInset;
  const sheetStyle = {
    "--mini-league-keyboard-inset": `${keyboardInset}px`,
    bottom: `${keyboardInset}px`,
  } as CSSProperties;

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        {!isExternallyControlled && (
          <SheetTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Players
            </Button>
          </SheetTrigger>
        )}
        <SheetContent
          side="bottom"
          className="h-[min(85vh,calc(100dvh-var(--mini-league-keyboard-inset)))] rounded-t-2xl flex flex-col overflow-hidden overscroll-contain"
          data-lock-keyboard-scroll="true"
          data-allow-scroll
          style={sheetStyle}
        >
          <SheetHeader className="mb-3 shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Add Players
            </SheetTitle>
            <SheetDescription>
              Add players to {miniLeagueName}
            </SheetDescription>
          </SheetHeader>

          <div ref={scrollContainerRef} data-allow-scroll className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6 pb-24 overscroll-contain scroll-pb-32" style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch", paddingBottom: "calc(6rem + var(--mini-league-keyboard-inset))" }}>
            {results.length > 0 ? (
              <div className="flex flex-col h-full space-y-3">
                <h3 className="text-sm font-medium">Results</h3>
                <ScrollArea className="flex-1 h-[50vh]">
                  <div className="space-y-2 pr-4">
                    {results.map((result, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-3 p-3 bg-muted rounded-lg">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{result.playerName}</p>
                          {result.parentEmail && (
                            <p className="text-xs text-muted-foreground truncate">{result.parentEmail}</p>
                          )}
                        </div>
                        <Badge variant={result.parentEmail ? (result.sent ? "default" : "secondary") : "outline"}>
                          {result.parentEmail
                            ? (result.sent ? "Email sent" : "Invite pending")
                            : "Added"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                <Button variant="outline" className="w-full" onClick={handleClose}>
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-4 pb-4">
                <MiniLeagueParentJoinLinkCard
                  miniLeagueId={miniLeagueId}
                  miniLeagueName={miniLeagueName}
                  clubId={clubId}
                />
                {!inviteByNameExpanded ? (
                  <button
                    type="button"
                    onClick={() => setInviteByNameExpanded(true)}
                    className="w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-3 text-sm font-medium hover:bg-muted/40 transition-colors min-h-[44px]"
                  >
                    <span className="inline-flex items-center gap-2">
                      <UserPlus className="h-4 w-4 text-muted-foreground" />
                      Invite a specific player
                    </span>
                    <span className="text-xs text-muted-foreground">Name or CSV</span>
                  </button>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <h3 className="text-sm font-semibold">Invite by name</h3>
                        <p className="text-xs text-muted-foreground">Search existing or add new players.</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => setCsvImportOpen(true)}>
                          <Upload className="h-4 w-4 mr-1" />
                          CSV
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setInviteByNameExpanded(false)}
                          aria-label="Collapse"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {players.map((player, idx) => {
                        return (
                          <div key={player.id} className="space-y-3 border-b border-border pb-4 last:border-b-0 last:pb-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium text-muted-foreground">Player {idx + 1}</p>
                              {players.length > 1 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0"
                                  onClick={() => removeRow(player.id)}
                                  aria-label={`Remove player ${idx + 1}`}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              )}
                            </div>

                            <div className="space-y-2 relative">
                              <Label htmlFor={`mini-league-player-name-${player.id}`}>Player name</Label>
                              <Input
                                id={`mini-league-player-name-${player.id}`}
                                placeholder="Search or type a new name"
                                value={player.name}
                                onFocus={(event) => {
                                  setActiveSearch({ rowId: player.id, field: "name" });
                                  keepFocusedInputVisible(event.currentTarget);
                                }}
                                onBlur={(event) => {
                                  if (focusedInputRef.current === event.currentTarget) focusedInputRef.current = null;
                                  setTimeout(() => setActiveSearch((s) => s?.rowId === player.id && s.field === "name" ? null : s), 150);
                                }}
                                onChange={(event) => updatePlayer(player.id, { name: event.target.value, existingChildId: undefined })}
                                onPaste={idx === 0 ? (event) => {
                                  const text = event.clipboardData.getData("text");
                                  if (handlePastePlayers(text)) event.preventDefault();
                                } : undefined}
                              />
                              {player.existingChildId && (
                                <p className="text-xs text-primary flex items-center gap-1">
                                  <Check className="h-3 w-3" /> Linked to existing player
                                </p>
                              )}
                              {activeSearch?.rowId === player.id && activeSearch.field === "name" && !player.existingChildId && player.name.trim().length >= 2 && (
                                <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border bg-muted/30 p-2">
                                  {activeChildSuggestions.length > 0 ? activeChildSuggestions.map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      className="w-full text-left p-2 rounded-lg hover:bg-background transition-colors text-sm"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        updatePlayer(player.id, {
                                          name: c.name,
                                          existingChildId: c.id,
                                          existingParentUserId: c.parent_id || undefined,
                                          parentName: c.parent_name || "",
                                        });
                                        setActiveSearch(null);
                                      }}
                                    >
                                      <p className="font-medium">{c.name}</p>
                                      {c.parent_name && <p className="text-xs text-muted-foreground">Parent: {c.parent_name}</p>}
                                    </button>
                                  )) : (
                                    <p className="px-2 py-1 text-xs text-muted-foreground">No existing players found — will add as new player</p>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor={`mini-league-ability-${player.id}`}>Ability rating</Label>
                              <select
                                id={`mini-league-ability-${player.id}`}
                                value={player.abilityRating}
                                onChange={(e) => updatePlayer(player.id, { abilityRating: e.target.value })}
                                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {abilityOptions.map((option) => (
                                  <option key={option.value || "none"} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <ParentInviteFields
                              idPrefix={`mini-league-parent-${player.id}`}
                              name={player.parentName}
                              email={player.parentEmail}
                              searchValue={player.parentName}
                              nameLabel="Parent name"
                              emailLabel={player.existingParentUserId ? "Parent email" : "Parent email (required to invite)"}
                              namePlaceholder="Search by name or email, or type new"
                              emailPlaceholder="redacted@example.invalid"
                              suggestions={
                                activeSearch?.rowId === player.id && activeSearch.field === "parentName" && player.parentName.trim().length >= 2
                                  ? activeParentSuggestions.map((parent): ParentInviteSuggestion => ({
                                      id: parent.id,
                                      name: parent.display_name || "Unknown",
                                      secondaryText: [
                                        ...(parent.roles || []).map((role) => role),
                                        parent.masked_email,
                                      ].filter(Boolean).join(" · "),
                                    }))
                                  : []
                              }
                              selectedSuggestion={player.existingParentUserId ? {
                                id: player.existingParentUserId,
                                name: player.parentName,
                              } : undefined}
                              onNameChange={(value) => updatePlayer(player.id, { parentName: value, existingParentUserId: undefined })}
                              onEmailChange={(value) => updatePlayer(player.id, { parentEmail: value })}
                              onSearchChange={setParentQuery}
                              onSelectSuggestion={(parent) => {
                                updatePlayer(player.id, {
                                  parentName: parent.name,
                                  existingParentUserId: parent.id,
                                  parentEmail: "",
                                });
                                setActiveSearch(null);
                              }}
                              onClearSelection={() => updatePlayer(player.id, { existingParentUserId: undefined, parentEmail: "" })}
                              onFocus={(event) => {
                                setActiveSearch({ rowId: player.id, field: "parentName" });
                                setParentQuery(player.parentName);
                                keepFocusedInputVisible(event.currentTarget);
                              }}
                              onBlur={() => setTimeout(() => setActiveSearch((s) => s?.rowId === player.id && s.field === "parentName" ? null : s), 150)}
                              requiredMessage="Enter the parent's email so they can be invited to the app."
                              emptyMessage="No existing parents found — keep typing to add manually"
                            />
                          </div>
                        );
                      })}
                    </div>

                    <Button variant="outline" className="w-full" onClick={addRow}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Another Player
                    </Button>

                    <Button
                      className="w-full"
                      onClick={() => addPlayersMutation.mutate(undefined)}
                      disabled={!players.some((player) => player.name.trim()) || players.some((p) => p.name.trim() && (!p.parentName.trim() || (!p.existingParentUserId && !p.parentEmail.trim()))) || isPending}
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Adding...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4 mr-2" />
                          {players.filter((player) => player.parentEmail.trim() && !player.existingParentUserId).length > 0
                            ? "Add & Send Invites"
                            : "Add Players"}
                        </>
                      )}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {csvImportOpen && (
        <Suspense fallback={null}>
          <MiniLeagueMemberCSVImportDialog
            open={csvImportOpen}
            onOpenChange={setCsvImportOpen}
            onImport={handleCSVImport}
          />
        </Suspense>
      )}
    </>
  );
}
