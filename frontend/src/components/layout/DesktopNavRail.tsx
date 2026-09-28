import {
  Home,
  Calendar,
  MessageCircle,
  Image as ImageIcon,
  Newspaper,
  Folder,
  ClipboardList,
  Settings,
} from "lucide-react";

import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { LogoImage } from "@/components/ui/logo-image";
import { useClubTheme } from "@/hooks/useClubTheme";
import { useDesktopNavAccess, useNextPitchBoardTarget } from "@/hooks/useDesktopNavAccess";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import igniteIcon from "@/assets/ignite-icon.png";

const coreItems = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/messages", icon: MessageCircle, label: "Messages" },
  { to: "/events", icon: Calendar, label: "Schedule" },
  { to: "/media", icon: ImageIcon, label: "Media" },
];

const itemClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "relative flex w-16 flex-col items-center gap-1 rounded-xl py-2 transition-colors",
    isActive
      ? "bg-primary-foreground/20 text-primary-foreground"
      : "text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground",
  );

/**
 * Desktop-only left nav rail (the "three-column dashboard" desktop shell).
 * Renders nothing on native platforms or below the lg breakpoint — mobile
 * keeps the existing BottomNav untouched.
 */
export function DesktopNavRail() {
  const { unreadMessagesCount } = useAuth();
  const { activeThemeData } = useClubTheme();
  const navigate = useNavigate();
  const { hasClubs, canAccessVault, canPitchBoard, teamIds, boardTeams } = useDesktopNavAccess();
  const pitchTarget = useNextPitchBoardTarget(teamIds, canPitchBoard);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);

  if (Capacitor.isNativePlatform()) return null;

  // "Clubs" intentionally lives in the top header ("Clubs & Teams"), and
  // Settings/account actions stay in the header too — the rail is content
  // destinations only.
  const secondaryItems = [
    ...(hasClubs ? [{ to: "/news", icon: Newspaper, label: "News" }] : []),
    ...(canAccessVault ? [{ to: "/vault", icon: Folder, label: "Vault" }] : []),
  ];


  return (
    <aside
      className="hidden lg:flex fixed left-0 top-0 bottom-0 z-40 w-24 flex-col items-center bg-primary text-primary-foreground py-6 gap-2 overflow-y-auto"
      aria-label="Primary navigation"
    >
      <NavLink
        to="/"
        aria-label="Ignite home"
        className="mb-4 block h-10 w-10 rounded-xl overflow-hidden bg-primary-foreground/10 shrink-0"
      >
        <LogoImage
          src={activeThemeData?.logoUrl || igniteIcon}
          alt="Ignite"
          className="h-10 w-10"
          imgClassName="object-cover"
        />
      </NavLink>

      <nav className="flex flex-1 flex-col items-center gap-1" aria-label="Main">
        {coreItems.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === "/"} aria-label={label} className={itemClass}>
            <span className="relative">
              <Icon className="h-6 w-6" aria-hidden="true" />
              {label === "Messages" && unreadMessagesCount > 0 && (
                <span
                  className="absolute -top-1 -right-2 flex items-center justify-center rounded-full bg-[hsl(0_72%_55%)] text-white text-[9px] font-semibold leading-none tabular-nums ring-2 ring-primary min-w-[16px] h-[15px] px-1"
                  aria-label={`${unreadMessagesCount} unread messages`}
                >
                  {unreadMessagesCount > 9 ? "9+" : unreadMessagesCount}
                </span>
              )}
            </span>
            <span className="text-[10px] font-medium leading-none">{label}</span>
          </NavLink>
        ))}

        {secondaryItems.length > 0 && (
          <div className="my-2 h-px w-12 bg-primary-foreground/20" role="presentation" />
        )}

        {secondaryItems.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} aria-label={label} className={itemClass}>
            <Icon className="h-6 w-6" aria-hidden="true" />
            <span className="text-[10px] font-medium leading-none">{label}</span>
          </NavLink>
        ))}

        {canPitchBoard && (
          <>
            <div className="my-2 h-px w-12 bg-primary-foreground/20" role="presentation" />
            <button
              type="button"
              aria-label="Pitch Board"
              onClick={() => {
                if (boardTeams.length > 1) {
                  setTeamPickerOpen(true);
                } else if (pitchTarget) {
                  navigate(pitchTarget);
                } else {
                  toast.info("Pitch Board is still loading. Please try again.");
                }
              }}
              className={cn(
                "relative flex w-16 flex-col items-center gap-1 rounded-xl py-2 transition-colors",
                "text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground",
              )}
            >
              <ClipboardList className="h-6 w-6" aria-hidden="true" />
              <span className="text-[10px] font-medium leading-none text-center">Pitch Board</span>
            </button>
          </>
        )}

        <div className="mt-auto flex flex-col items-center pt-4">
          <div className="mb-2 h-px w-12 bg-primary-foreground/20" role="presentation" />
          <NavLink to="/settings" aria-label="Settings" className={itemClass}>
            <Settings className="h-6 w-6" aria-hidden="true" />
            <span className="text-[10px] font-medium leading-none">Settings</span>
          </NavLink>
        </div>
      </nav>

      <Dialog open={teamPickerOpen} onOpenChange={setTeamPickerOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Open Pitch Board</DialogTitle>
            <DialogDescription>Choose which team's board to open.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {boardTeams.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => {
                  setTeamPickerOpen(false);
                  navigate(`/teams/${team.id}?openPitchBoard=1`);
                }}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left text-sm font-medium hover:bg-accent transition-colors"
              >
                <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {team.name}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
