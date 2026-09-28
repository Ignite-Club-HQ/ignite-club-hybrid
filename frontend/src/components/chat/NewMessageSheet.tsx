import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { MessageCircle, Users, ChevronRight, Lock, UserPlus, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface NewMessageSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCreateGroups: boolean;
  /** Any member of a Pro club can start a plain group message (no category). */
  canCreateCustomGroup?: boolean;
  hasPro?: boolean;
  isAppAdmin?: boolean;
  upgradeClubId?: string | null;
  onPickDM: () => void;
  onPickCustom: () => void;
  onPickTeam: () => void;
  onPickRole: () => void;
}

interface ActionRowProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  accent: "primary" | "violet" | "amber" | "sky";
  locked?: boolean;
  onClick: () => void;
}

function ActionRow({ icon: Icon, title, subtitle, accent, locked, onClick }: ActionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-4 rounded-2xl p-4 text-left",
        "bg-card border border-border",
        "active:scale-[0.985] transition-transform touch-manipulation",
        "hover:border-primary/40 hover:bg-accent/30"
      )}
    >
      <div
        className={cn(
          "h-12 w-12 shrink-0 rounded-2xl flex items-center justify-center relative",
          accent === "primary" && "bg-primary/15 text-primary",
          accent === "violet" && "bg-violet-500/15 text-violet-400",
          accent === "amber" && "bg-amber-500/15 text-amber-400",
          accent === "sky" && "bg-sky-500/15 text-sky-400"
        )}
      >
        <Icon className="h-6 w-6" />
        {locked && (
          <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center">
            <Lock className="h-3 w-3 text-primary" />
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-base font-semibold leading-tight flex items-center gap-1.5">
          {title}
          {locked && (
            <span className="text-[10px] uppercase tracking-wide font-semibold text-primary">
              Pro
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
    </button>
  );
}

export function NewMessageSheet({
  open,
  onOpenChange,
  canCreateGroups,
  canCreateCustomGroup,
  hasPro,
  isAppAdmin,
  upgradeClubId,
  onPickDM,
  onPickCustom,
  onPickTeam,
  onPickRole,
}: NewMessageSheetProps) {
  const navigate = useNavigate();
  const gated = !hasPro && !isAppAdmin;

  const goUpgrade = () => {
    onOpenChange(false);
    if (upgradeClubId) {
      navigate(`/clubs/${upgradeClubId}/upgrade`);
    } else {
      navigate(`/clubs`);
    }
  };

  const pick = (fn: () => void) => () => {
    if (gated) {
      goUpgrade();
      return;
    }
    onOpenChange(false);
    fn();
  };

  // Plain group messages are available to every member of a Pro club.
  // Team/role auto-synced groups stay admin-only. Locked rows still show as a
  // Pro upsell when the club isn't on Pro.
  const showCustomRow = canCreateCustomGroup || gated;
  const showAdminGroupRows = canCreateGroups || gated;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        enableDragToClose
        hideCloseButton
        className="rounded-t-3xl border-t border-border bg-background p-0 max-h-[85vh] overflow-y-auto"
      >
        <div className="px-5 pt-1 pb-5">
          <SheetHeader className="text-left pb-4">
            <SheetTitle className="text-xl">New message</SheetTitle>
            <SheetDescription className="text-xs">
              Pick who you want to talk to
            </SheetDescription>
          </SheetHeader>

          {gated && (
            <button
              type="button"
              onClick={goUpgrade}
              className="w-full mb-3 flex items-start gap-3 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-3 text-left hover:bg-primary/10 transition-colors"
            >
              <div className="h-8 w-8 shrink-0 rounded-full bg-primary/15 flex items-center justify-center">
                <Lock className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight">
                  Starting new chats is a Pro feature
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                  Upgrade your club to start direct messages and groups. Tap to upgrade.
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
            </button>
          )}

          <div className="space-y-2.5">
            <ActionRow
              icon={MessageCircle}
              title="Direct message"
              subtitle={gated ? "Pro feature — tap to upgrade" : "One person, or a quick chat with a few"}
              accent="primary"
              locked={gated}
              onClick={pick(onPickDM)}
            />
            {showCustomRow && (
              <ActionRow
                icon={UserPlus}
                title="Group message"
                subtitle={gated ? "Pro feature — tap to upgrade" : "Choose the members and give it a name"}
                accent="amber"
                locked={gated}
                onClick={pick(onPickCustom)}
              />
            )}
            {showAdminGroupRows && (
              <>
                <ActionRow
                  icon={Users}
                  title="Team group"
                  subtitle={gated ? "Pro feature — tap to upgrade" : "Everyone in a team, kept in sync"}
                  accent="violet"
                  locked={gated}
                  onClick={pick(onPickTeam)}
                />
                <ActionRow
                  icon={Shield}
                  title="Role-based group"
                  subtitle={gated ? "Pro feature — tap to upgrade" : "Everyone with a role, kept in sync"}
                  accent="sky"
                  locked={gated}
                  onClick={pick(onPickRole)}
                />
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
