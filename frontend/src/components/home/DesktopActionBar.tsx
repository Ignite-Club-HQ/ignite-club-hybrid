import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar,
  Newspaper,
  ImagePlus,
  UserPlus,
  Users,
  ChevronDown,
  Users2,
  Trophy,
  Building2,
  Shield,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ClubNewsComposer from "@/components/news/ClubNewsComposer";
import { useNewsPublishableClubs } from "@/features/news/useClubNews";

interface DesktopActionBarProps {
  onInvite: () => void;
  onJoinTeam: () => void;
  hasTeams: boolean;
  canCreateTeam?: boolean;
  canCreateEvent?: boolean;
  isAppAdmin?: boolean;
  activeClubFilter?: string | null;
}

/**
 * Desktop-only (lg+) row of real buttons on Home. Same handlers and permission
 * gating as the mobile quick-actions sheet — nothing new, just visible.
 */
export function DesktopActionBar({
  onInvite,
  onJoinTeam,
  hasTeams,
  canCreateTeam = false,
  canCreateEvent = false,
  isAppAdmin = false,
  activeClubFilter,
}: DesktopActionBarProps) {
  const navigate = useNavigate();
  const [composerOpen, setComposerOpen] = useState(false);
  const { data: publishableClubs = [] } = useNewsPublishableClubs();

  if (Capacitor.isNativePlatform()) return null;

  return (
    <div className="hidden lg:flex flex-wrap items-center gap-2">
      {canCreateEvent && (
        <Button size="sm" onClick={() => navigate("/events/new")}>
          <Calendar className="h-4 w-4" />
          New Event
        </Button>
      )}
      {publishableClubs.length > 0 && (
        <Button size="sm" variant="secondary" onClick={() => setComposerOpen(true)}>
          <Newspaper className="h-4 w-4" />
          News Post
        </Button>
      )}
      <Button size="sm" variant="secondary" onClick={() => navigate("/media?upload=1")}>
        <ImagePlus className="h-4 w-4" />
        Upload Photo/Video
      </Button>
      {hasTeams && (
        <Button size="sm" variant="outline" onClick={onInvite}>
          <UserPlus className="h-4 w-4" />
          Invite Members
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={onJoinTeam}>
        <Users className="h-4 w-4" />
        Join Team
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost">
            More
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canCreateTeam && (
            <DropdownMenuItem onClick={() => navigate("/teams/new")}>
              <Users2 className="h-4 w-4" />
              Create Team
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => navigate("/competitions/new")}>
            <Trophy className="h-4 w-4" />
            Create Competition
          </DropdownMenuItem>
          {!activeClubFilter && (
            <DropdownMenuItem onClick={() => navigate("/associations/new")}>
              <Building2 className="h-4 w-4" />
              Start an Association
            </DropdownMenuItem>
          )}
          {isAppAdmin && (
            <DropdownMenuItem onClick={() => navigate("/admin")}>
              <Shield className="h-4 w-4" />
              Admin Tools
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {composerOpen && (
        <ClubNewsComposer
          open={composerOpen}
          onOpenChange={setComposerOpen}
          defaultClubId={activeClubFilter}
        />
      )}
    </div>
  );
}
