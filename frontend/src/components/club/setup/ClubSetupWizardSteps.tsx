import { useState, useMemo } from "react";
import {
  Users,
  UserPlus,
  Shield,
  Check,
  Loader2,
  Plus,
  X,
  Copy,
  Share2,
  Mail,
  CheckCircle2,
  Sparkles,
  ClipboardPaste,
  QrCode,
  ChevronDown,
  Crown,
} from "lucide-react";

import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { parseRecipients, looksLikeMultiRecipient } from "@/components/invite/recipientParser";
import TeamJoinLinkCard from "@/components/invite/TeamJoinLinkCard";

// ---------- shared local types ----------

export type ClubRole = "club_admin" | "committee_member";
export type TeamRole = "team_admin" | "coach" | "player" | "parent";

export interface DraftTeam {
  tempId: string;
  name: string;
  levelAge: string;
  createdTeamId?: string; // set after Save
}

export interface DraftInvite {
  tempId: string;
  name: string;
  email: string;
  role: ClubRole | TeamRole;
  teamId?: string; // for team-scoped invites
  status: "pending" | "sending" | "sent" | "error";
  link?: string;
  errorMsg?: string;
}

// ---------- shared ----------

export function StepIntro({
  icon: Icon,
  title,
  subtitle,
  proBadge,
}: {
  icon: any;
  title: string;
  subtitle: string;
  proBadge?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-primary/5 border border-primary/15 p-4">
      <div className="p-2 rounded-lg bg-primary/15 shrink-0">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-sm">{title}</p>
          {proBadge && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
              <Crown className="h-2.5 w-2.5" /> Pro
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
          {subtitle}
        </p>
      </div>
      <Sparkles className="h-4 w-4 text-primary/40 shrink-0 mt-1" />
    </div>
  );
}
// ---------- step: teams ----------

export function TeamsStep({
  teams,
  setTeams,
  onSave,
  saving,
}: {
  teams: DraftTeam[];
  setTeams: React.Dispatch<React.SetStateAction<DraftTeam[]>>;
  onSave: (t: DraftTeam) => void;
  saving: boolean;
}) {
  const addRow = () =>
    setTeams((prev) => [
      ...prev,
      { tempId: crypto.randomUUID(), name: "", levelAge: "" },
    ]);
  const removeRow = (id: string) =>
    setTeams((prev) => prev.filter((t) => t.tempId !== id));
  const update = (id: string, patch: Partial<DraftTeam>) =>
    setTeams((prev) =>
      prev.map((t) => (t.tempId === id ? { ...t, ...patch } : t)),
    );

  return (
    <div className="space-y-4">
      <StepIntro
        icon={Users}
        title="Create your teams"
        subtitle="Most clubs start with one or two teams. Add the teams you want to set up now — you can add more anytime from Club Settings."
      />


      <div className="space-y-3">
        {teams.map((t, i) => (
          <div
            key={t.tempId}
            className={cn(
              "rounded-xl border p-3 space-y-3 transition-colors",
              t.createdTeamId
                ? "bg-emerald-500/5 border-emerald-500/30"
                : "bg-card",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Team {i + 1}
              </span>
              <div className="flex items-center gap-2">
                {t.createdTeamId && (
                  <Badge variant="outline" className="text-emerald-600 border-emerald-500/40">
                    <Check className="h-3 w-3 mr-1" /> Saved
                  </Badge>
                )}
                {teams.length > 1 && !t.createdTeamId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => removeRow(t.tempId)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={t.name}
                  onChange={(e) => update(t.tempId, { name: e.target.value })}
                  placeholder="e.g. U12 Lions"
                  disabled={!!t.createdTeamId}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Age group or level (optional)</Label>
                <Input
                  value={t.levelAge}
                  onChange={(e) =>
                    update(t.tempId, { levelAge: e.target.value })
                  }
                  placeholder="U12, Div 3, Seniors…"
                  disabled={!!t.createdTeamId}
                />
              </div>
            </div>
            {!t.createdTeamId && t.name.trim() && (
              <p className="text-[11px] text-muted-foreground">
                Saves automatically when you tap Continue.
              </p>
            )}
          </div>
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={addRow}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-1" /> Add another team
      </Button>

      <BulkPasteTeams
        onAdd={(names) =>
          setTeams((prev) => {
            const existing = new Set(
              prev.map((p) => p.name.trim().toLowerCase()).filter(Boolean),
            );
            const additions = names
              .map((n) => n.trim())
              .filter((n) => n && !existing.has(n.toLowerCase()))
              .map((n) => ({
                tempId: crypto.randomUUID(),
                name: n,
                levelAge: "",
              }));
            // Drop the trailing empty placeholder row if user is pasting.
            const kept = prev.filter(
              (t) => t.createdTeamId || t.name.trim() !== "",
            );
            return [...kept, ...additions];
          })
        }
      />
    </div>
  );
}

// ---------- step: generic invite list ----------

export function InviteStep({
  title,
  subtitle,
  roleOptions,
  defaultRole,
  list,
  setList,
  onSend,
}: {
  title: string;
  subtitle: string;
  roleOptions: { value: ClubRole; label: string }[];
  defaultRole: ClubRole;
  list: DraftInvite[];
  setList: React.Dispatch<React.SetStateAction<DraftInvite[]>>;
  onSend: (inv: DraftInvite) => void;
}) {
  const addRow = () =>
    setList((prev) => [
      ...prev,
      {
        tempId: crypto.randomUUID(),
        name: "",
        email: "",
        role: defaultRole,
        status: "pending",
      },
    ]);

  const remove = (id: string) =>
    setList((prev) => prev.filter((i) => i.tempId !== id));
  const update = (id: string, patch: Partial<DraftInvite>) =>
    setList((prev) =>
      prev.map((i) => (i.tempId === id ? { ...i, ...patch } : i)),
    );

  return (
    <div className="space-y-4">
      <StepIntro icon={Shield} title={title} subtitle={subtitle} />

      <div className="space-y-3">
        {list.length === 0 && (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No invites yet. Add one below or skip for later.
          </div>
        )}
        {list.map((inv) => (
          <InviteRow
            key={inv.tempId}
            invite={inv}
            roleOptions={roleOptions}
            onChange={(patch) => update(inv.tempId, patch)}
            onRemove={() => remove(inv.tempId)}
            onSend={() => onSend(inv)}
          />
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={addRow} className="w-full">
        <Plus className="h-4 w-4 mr-1" /> Add invite
      </Button>

      <BulkPasteInvites
        onAdd={(rows) =>
          setList((prev) => {
            const existing = new Set(
              prev.map((p) => (p.email || p.name).trim().toLowerCase()),
            );
            const additions = rows
              .filter((r) => !existing.has((r.email || r.name).toLowerCase()))
              .map((r) => ({
                tempId: crypto.randomUUID(),
                name: r.name,
                email: r.email,
                role: defaultRole,
                status: "pending" as const,
              }));
            return [...prev, ...additions];
          })
        }
      />
    </div>
  );
}

// ---------- step: team invites (team-scoped: admins, coaches, players, parents) ----------

export function TeamInvitesStep({
  teams,
  list,
  setList,
  onSend,
}: {
  teams: DraftTeam[];
  list: DraftInvite[];
  setList: React.Dispatch<React.SetStateAction<DraftInvite[]>>;
  onSend: (inv: DraftInvite) => void;
}) {
  const roleOptions = useMemo(
    () => [
      { value: "team_admin" as const, label: "Team Admin" },
      { value: "coach" as const, label: "Coach" },
      { value: "player" as const, label: "Player" },
      { value: "parent" as const, label: "Parent" },
    ],
    [],
  );

  const addRow = (teamId: string, role: TeamRole = "player") =>

    setList((prev) => [
      ...prev,
      {
        tempId: crypto.randomUUID(),
        name: "",
        email: "",
        role,
        teamId,
        status: "pending",
      },
    ]);
  const remove = (id: string) =>
    setList((prev) => prev.filter((i) => i.tempId !== id));
  const update = (id: string, patch: Partial<DraftInvite>) =>
    setList((prev) =>
      prev.map((i) => (i.tempId === id ? { ...i, ...patch } : i)),
    );

  if (teams.length === 0) {
    return (
      <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
        Add a team in the previous step first.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StepIntro
        icon={UserPlus}
        title="Invite people to your teams"
        subtitle="Add coaches, team admins, players and parents to the teams you created. Each person will receive their own invitation link. You can also skip this and invite people later."
      />

      {teams.map((team) => {
        const teamList = list.filter((i) => i.teamId === team.createdTeamId);
        return (
          <TeamInviteBlock
            key={team.createdTeamId}
            team={team}
            teamList={teamList}
            roleOptions={roleOptions as any}
            onAddRow={() => addRow(team.createdTeamId!, "player")}
            onUpdate={update}
            onRemove={remove}
            onSend={onSend}
            onBulkAdd={(rows) =>
              setList((prev) => {
                const teamKeys = new Set(
                  prev
                    .filter((p) => p.teamId === team.createdTeamId)
                    .map((p) => (p.email || p.name).trim().toLowerCase()),
                );
                const additions = rows
                  .filter((r) => !teamKeys.has((r.email || r.name).toLowerCase()))
                  .map((r) => ({
                    tempId: crypto.randomUUID(),
                    name: r.name,
                    email: r.email,
                    role: "player" as TeamRole,
                    teamId: team.createdTeamId,
                    status: "pending" as const,
                  }));
                return [...prev, ...additions];
              })
            }
          />
        );
      })}
    </div>
  );
}

export function TeamInviteBlock({
  team,
  teamList,
  roleOptions,
  onAddRow,
  onUpdate,
  onRemove,
  onSend,
  onBulkAdd,
}: {
  team: DraftTeam;
  teamList: DraftInvite[];
  roleOptions: { value: TeamRole; label: string }[];
  onAddRow: () => void;
  onUpdate: (id: string, patch: Partial<DraftInvite>) => void;
  onRemove: (id: string) => void;
  onSend: (inv: DraftInvite) => void;
  onBulkAdd: (rows: { name: string; email: string }[]) => void;
}) {
  const [showJoinLink, setShowJoinLink] = useState(false);
  return (
    <div className="rounded-xl border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{team.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {teamList.length === 0
              ? "0 people invited"
              : `${teamList.length} ${teamList.length === 1 ? "person" : "people"} invited`}
          </p>
        </div>
        {team.createdTeamId && (
          <Button
            variant={showJoinLink ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setShowJoinLink((v) => !v)}
            className="shrink-0 gap-1"
          >
            <QrCode className="h-4 w-4" />
            <span className="hidden sm:inline">Share join link</span>
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", showJoinLink && "rotate-180")}
            />
          </Button>
        )}
      </div>

      {showJoinLink && team.createdTeamId && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <TeamJoinLinkCard
            teamId={team.createdTeamId}
            teamName={team.name}
            teamType="mixed"
          />
        </div>
      )}

      {teamList.length > 0 && (
        <div className="space-y-2">
          {teamList.map((inv) => (
            <InviteRow
              key={inv.tempId}
              invite={inv}
              roleOptions={roleOptions as any}
              onChange={(patch) => onUpdate(inv.tempId, patch)}
              onRemove={() => onRemove(inv.tempId)}
              onSend={() => onSend(inv)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={onAddRow}>
          <UserPlus className="h-4 w-4 mr-1" /> Add members
        </Button>
        <BulkPasteInvites
          compact
          triggerLabel="Paste a member list"
          onAdd={onBulkAdd}
        />
      </div>
    </div>
  );
}


// ---------- reusable invite row ----------

export function InviteRow({
  invite,
  roleOptions,
  onChange,
  onRemove,
  onSend,
}: {
  invite: DraftInvite;
  roleOptions: { value: string; label: string }[];
  onChange: (patch: Partial<DraftInvite>) => void;
  onRemove: () => void;
  onSend: () => void;
}) {
  const { toast } = useToast();
  const isSent = invite.status === "sent";
  const isSending = invite.status === "sending";

  const share = async () => {
    if (!invite.link) return;
    const msg = `You've been invited. Tap here to join: ${invite.link}`;
    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({ title: "Invite", text: msg });
        return;
      } catch {
        /* cancelled */
      }
    }
    window.open(`https://reference.invalid)}`, "_blank");
  };

  const copy = async () => {
    if (!invite.link) return;
    try {
      await navigator.clipboard.writeText(invite.link);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-3 space-y-2",
        isSent ? "bg-emerald-500/5 border-emerald-500/30" : "bg-card",
      )}
    >
      <div className="flex items-center gap-2">
        <Input
          value={invite.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Name"
          disabled={isSent || isSending}
          className="h-9"
        />
        <Select
          value={invite.role}
          onValueChange={(v) => onChange({ role: v as any })}
          disabled={isSent || isSending}
        >
          <SelectTrigger className="h-9 w-[140px] shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!isSent && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={onRemove}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="relative">
        <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="email"
          value={invite.email}
          onChange={(e) => onChange({ email: e.target.value })}
          placeholder="Email (optional — we'll send them the invite)"
          disabled={isSent || isSending}
          className="h-9 pl-9"
        />
      </div>

      {!isSent ? (
        <Button
          size="sm"
          className="w-full"
          onClick={onSend}
          disabled={!invite.name.trim() || isSending}
        >
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <UserPlus className="h-4 w-4 mr-1" /> Send invite
            </>
          )}
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {invite.email
              ? `Emailed to ${invite.email}`
              : "Invite created — share the link"}
          </div>
          {invite.errorMsg && (
            <p className="text-xs text-amber-600">
              Email issue: {invite.errorMsg}. Share the link manually.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={share}
            >
              <Share2 className="h-3.5 w-3.5 mr-1" /> Share
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={copy}
            >
              <Copy className="h-3.5 w-3.5 mr-1" /> Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- shared: bulk-paste invites ----------

export function BulkPasteInvites({
  onAdd,
  compact,
  triggerLabel,
}: {
  onAdd: (rows: { name: string; email: string }[]) => void;
  compact?: boolean;
  triggerLabel?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseRecipients(text), [text]);
  const showHint = text.length > 0 && !looksLikeMultiRecipient(text) && parsed.length < 2;

  const submit = () => {
    if (parsed.length === 0) {
      toast({ title: "Nothing to add", description: "Paste a list of names or emails first.", variant: "destructive" });
      return;
    }
    onAdd(parsed);
    toast({ title: `Added ${parsed.length} to the list`, description: "Review, then Send." });
    setText("");
    setOpen(false);
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn(
          "w-full text-muted-foreground",
          compact && "flex-1 h-9 text-xs sm:text-sm",
        )}
      >
        <ClipboardPaste className="h-3.5 w-3.5 mr-1" />
        {triggerLabel ?? "Bulk paste names / emails"}
      </Button>
    );
  }


  return (
    <div className="rounded-xl border p-3 space-y-2 bg-card">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">Paste a list</p>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setOpen(false); setText(""); }}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        One per line — <code>Alex Smith &lt;redacted@example.invalid&gt;</code>, <code>redacted@example.invalid</code>, or just a name.
        Duplicates are removed.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={"Alex Smith <redacted@example.invalid>\redacted@example.invalid\nSam Lee"}
        className="text-sm"
      />
      {showHint && (
        <p className="text-[11px] text-amber-600">
          Only detected 1 recipient — separate multiple entries by new lines.
        </p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {parsed.length} detected
        </span>
        <Button size="sm" onClick={submit} disabled={parsed.length === 0}>
          Add {parsed.length || ""}
        </Button>
      </div>
    </div>
  );
}

// ---------- shared: bulk-paste team names (one per line) ----------

export function BulkPasteTeams({ onAdd }: { onAdd: (names: string[]) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const lines = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    [text],
  );

  const submit = () => {
    if (lines.length === 0) {
      toast({ title: "Nothing to add", description: "Paste one team name per line.", variant: "destructive" });
      return;
    }
    onAdd(lines);
    toast({ title: `Added ${lines.length} team${lines.length === 1 ? "" : "s"}` });
    setText("");
    setOpen(false);
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-full text-muted-foreground"
      >
        <ClipboardPaste className="h-3.5 w-3.5 mr-1" /> Paste a list of team names
      </Button>
    );
  }

  return (
    <div className="rounded-xl border p-3 space-y-2 bg-card">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">Paste team names</p>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setOpen(false); setText(""); }}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        One team name per line. Duplicates are removed automatically.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={"U10 Lions\nU12 Girls\nSeniors"}
        className="text-sm"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {lines.length} detected
        </span>
        <Button size="sm" onClick={submit} disabled={lines.length === 0}>
          Add {lines.length || ""}
        </Button>
      </div>
    </div>
  );
}

