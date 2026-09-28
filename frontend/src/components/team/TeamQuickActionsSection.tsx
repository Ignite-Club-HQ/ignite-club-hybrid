import { ChevronRight, FolderOpen, LayoutGrid, Lock, MessageCircle, Calendar, Image as ImageIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TeamChatPreview } from "./TeamChatPreview";

interface TeamQuickActionsSectionProps {
  teamId: string;
  isSubscriptionLoading: boolean;
  isTeamPro: boolean;
  isAppAdmin: boolean;
  isAdmin: boolean;
  isCoachOrAdmin: boolean;
  isClubAdmin: boolean;
  hasNearbySubsManagerDuty: boolean;
  showPitch: boolean;
  onPitchBoardClick: () => void | Promise<void>;
}

function QuickActionTile({
  icon: Icon,
  label,
  to,
  onClick,
  locked,
}: {
  icon: typeof Calendar;
  label: string;
  to?: string;
  onClick?: () => void;
  locked?: boolean;
}) {
  const inner = (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-1 rounded-lg border bg-card/60 px-1 py-2.5 h-[68px] transition-colors",
        locked ? "opacity-50" : "hover:border-primary/40 hover:bg-card active:scale-[0.97]",
      )}
    >
      <Icon className="h-[18px] w-[18px] text-foreground/80" aria-hidden="true" />
      <span className="text-[11px] font-medium text-foreground/90 leading-none">{label}</span>
      {locked && <Lock className="absolute top-1 right-1 h-2.5 w-2.5 text-muted-foreground" aria-hidden="true" />}
    </div>
  );

  if (locked) {
    return <div aria-disabled="true">{inner}</div>;
  }
  if (to) {
    return (
      <Link to={to} aria-label={label} className="block">
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" aria-label={label} onClick={onClick} className="block text-left w-full">
      {inner}
    </button>
  );
}

export function TeamQuickActionsSection({
  teamId,
  isSubscriptionLoading,
  isTeamPro,
  isAppAdmin,
  isAdmin,
  isCoachOrAdmin,
  isClubAdmin,
  hasNearbySubsManagerDuty,
  showPitch,
  onPitchBoardClick,
}: TeamQuickActionsSectionProps) {
  const showVault = isAdmin || isCoachOrAdmin || isClubAdmin;
  const vaultLocked = showVault && !(isSubscriptionLoading || isTeamPro);
  const mediaLocked = !(isSubscriptionLoading || isTeamPro);

  const tiles: Array<{
    key: string;
    icon: typeof Calendar;
    label: string;
    to?: string;
    onClick?: () => void;
    locked?: boolean;
  }> = [
    { key: "schedule", icon: Calendar, label: "Schedule", to: `/events?team=${teamId}` },
    { key: "media", icon: ImageIcon, label: "Media", to: mediaLocked ? undefined : `/media?team=${teamId}`, locked: mediaLocked },
  ];
  if (showVault) {
    tiles.push({
      key: "vault",
      icon: FolderOpen,
      label: "Vault",
      to: vaultLocked ? undefined : `/vault?team=${teamId}`,
      locked: vaultLocked,
    });
  }
  if (showPitch) {
    tiles.push({
      key: "pitch",
      icon: LayoutGrid,
      label: "Pitch Board",
      onClick: onPitchBoardClick,
    });
  }

  const cols = tiles.length >= 4 ? "grid-cols-4" : tiles.length === 3 ? "grid-cols-3" : "grid-cols-2";

  return (
    <section className="space-y-2">
      <Link to={`/messages/${teamId}`} aria-label="Open team chat" className="block">
        <Card className="border-primary/20 bg-primary/[0.03] hover:border-primary/40 transition-colors" role="button">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <MessageCircle className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
            </div>
            <TeamChatPreview teamId={teamId} />
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </CardContent>
        </Card>
      </Link>

      <div className={cn("grid gap-2", cols)}>
        {tiles.map(({ key, icon, label, to, onClick, locked }) => (
          <QuickActionTile key={key} icon={icon} label={label} to={to} onClick={onClick} locked={locked} />
        ))}
      </div>
    </section>
  );
}
