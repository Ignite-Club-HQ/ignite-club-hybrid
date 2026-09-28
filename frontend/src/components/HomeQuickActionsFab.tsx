import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  UserPlus,
  Users,
  Trophy,
  Calendar,
  MessageCircle,
  Users2,
  Building2,
  ChevronRight,
  ChevronLeft,
  SlidersHorizontal,
  ImagePlus,
  Folder,
  Shield,
  Lock,
  Newspaper,
} from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { CreateActionButton } from "@/components/CreateActionButton";
import { Separator } from "@/components/ui/separator";
import ClubNewsComposer from "@/components/news/ClubNewsComposer";
import { useNewsPublishableClubs } from "@/features/news/useClubNews";

interface HomeQuickActionsFabProps {
  onInvite: () => void;
  onJoinTeam: () => void;
  hasTeams: boolean;
  canCreateTeam?: boolean;
  canCreateEvent?: boolean;
  canAccessVault?: boolean;
  isAppAdmin?: boolean;
  activeClubFilter?: string | null;
  activeClubName?: string | null;
  hasProContext?: boolean;
}

type ActionItem = {
  label: string;
  description?: string;
  icon: typeof Plus;
  onClick: () => void;
  proLocked?: boolean;
};

export function HomeQuickActionsFab({
  onInvite,
  onJoinTeam,
  hasTeams,
  canCreateTeam = false,
  canCreateEvent = false,
  canAccessVault = false,
  isAppAdmin = false,
  activeClubFilter,
  activeClubName,
  hasProContext = false,
}: HomeQuickActionsFabProps) {
  const proLocked = !hasProContext && !isAppAdmin;

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "more">("main");
  const [composerOpen, setComposerOpen] = useState(false);
  const navigate = useNavigate();
  const { data: publishableClubs = [] } = useNewsPublishableClubs();

  const close = () => setOpen(false);
  const go = (path: string) => {
    close();
    navigate(path);
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) setView("main");
  };

  // Primary — highest-frequency actions (weekly / monthly use)
  const primary: ActionItem[] = [
    // New-user primary CTAs: if they have no teams yet, surface the setup entry points at the top.
    ...(!hasTeams
      ? [
          {
            label: "Start a Club",
            description: "Multiple teams, committee & branding",
            icon: Building2,
            onClick: () => go("/clubs/new"),
          } as ActionItem,
          {
            label: "Start a Team",
            description: "One team — chat, schedule & RSVPs",
            icon: Users2,
            onClick: () => go("/teams/new"),
          } as ActionItem,
        ]
      : []),
    {
      label: "Post Photo/Video",
      icon: ImagePlus,
      onClick: () => go("/media?upload=1"),
    },
    ...(canCreateEvent
      ? [
          {
            label: "New Event",
            icon: Calendar,
            onClick: () => go("/events/new"),
          } as ActionItem,
        ]
      : []),
    ...(publishableClubs.length > 0
      ? [
          {
            label: "Create News Post",
            icon: Newspaper,
            onClick: () => {
              close();
              setComposerOpen(true);
            },
          } as ActionItem,
        ]
      : []),
    {
      label: "Join Team / Request Access",
      description: "Request Coach or Admin access",
      icon: Users,
      onClick: () => {
        close();
        onJoinTeam();
      },
    },
    ...(canAccessVault
      ? [
          {
            label: "Club Files",
            description: "Forms, policies & documents",
            icon: Folder,
            onClick: () => go("/vault"),
            proLocked,
          } as ActionItem,
        ]
      : []),
  ];

  // More — low-frequency administrative actions
  const more: ActionItem[] = [
    {
      label: "New Thread",
      icon: MessageCircle,
      onClick: () => go("/messages?new=picker"),
      proLocked,
    },
    ...(hasTeams
      ? [
          {
            label: "Invite Members",
            icon: UserPlus,
            onClick: () => {
              close();
              onInvite();
            },
          } as ActionItem,
        ]
      : []),
    ...(canCreateTeam
      ? [
          {
            label: "Create Team",
            icon: Users2,
            onClick: () => go("/teams/new"),
          } as ActionItem,
        ]
      : []),
    {
      label: "Create Competition",
      icon: Trophy,
      onClick: () => go("/competitions/new"),
      proLocked,
    },
    ...(!activeClubFilter
      ? [
          {
            label: "Start an Association",
            icon: Building2,
            onClick: () => go("/associations/new"),
            proLocked,
          } as ActionItem,

        ]
      : []),
    ...(isAppAdmin
      ? [
          {
            label: "Admin Tools",
            icon: Shield,
            onClick: () => go("/admin"),
          } as ActionItem,
        ]
      : []),
  ];

  const rowClass =
    "flex items-center gap-3 w-full min-h-[66px] px-3 py-3 rounded-xl hover:bg-accent/50 active:bg-accent active:scale-[0.99] transition-all text-left touch-manipulation select-none";

  const PrimaryRow = ({ item }: { item: ActionItem }) => (
    <button key={item.label} type="button" onClick={item.onClick} className={rowClass}>
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary shrink-0">
        <item.icon className="h-[22px] w-[22px]" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="block text-[15px] font-semibold text-foreground truncate">
            {item.label}
          </span>
          {item.proLocked && (
            <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-label="Pro only" />
          )}
        </span>
        {item.description && (
          <span className="block text-[12px] text-muted-foreground truncate">
            {item.description}
          </span>
        )}
      </span>
    </button>
  );

  const MutedRow = ({ item }: { item: ActionItem }) => (
    <button key={item.label} type="button" onClick={item.onClick} className={rowClass}>
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground shrink-0">
        <item.icon className="h-[22px] w-[22px]" />
      </span>
      <span className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="text-[15px] font-medium text-foreground/80 truncate">
          {item.label}
        </span>
        {item.proLocked && (
          <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-label="Pro only" />
        )}
      </span>
    </button>
  );


  return (
    <>
      <CreateActionButton ariaLabel="Quick actions" onClick={() => setOpen(true)} />

      <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
        <ResponsiveDialogContent className="max-w-md">
          {view === "main" ? (
            <>
              <ResponsiveDialogHeader className="text-left p-4 pb-2">
                <ResponsiveDialogTitle className="text-lg font-semibold tracking-tight">
                  Quick Actions
                </ResponsiveDialogTitle>
                {activeClubName && (
                  <p className="text-sm text-muted-foreground">
                    {activeClubName}
                  </p>
                )}
              </ResponsiveDialogHeader>

              <div className="px-2 pb-6 pt-0 space-y-0">
                {primary.map((item) => (
                  <PrimaryRow key={item.label} item={item} />
                ))}

                <div className="py-2 px-3">
                  <Separator className="bg-border/40" />
                </div>

                <button
                  type="button"
                  onClick={() => setView("more")}
                  className={rowClass}
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground shrink-0">
                    <SlidersHorizontal className="h-[22px] w-[22px]" />
                  </span>
                  <span className="text-[15px] font-medium text-muted-foreground truncate">
                    More Actions
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
                </button>
              </div>
            </>
          ) : (
            <>
              <ResponsiveDialogHeader className="text-left p-4 pb-2 flex flex-row items-center gap-1">
                <button
                  type="button"
                  onClick={() => setView("main")}
                  className="inline-flex h-12 w-12 items-center justify-center rounded-full -ml-2 shrink-0 touch-manipulation active:scale-95 transition-all"
                  aria-label="Back"
                >
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <ChevronLeft className="h-4 w-4" />
                  </span>
                </button>

                <ResponsiveDialogTitle className="text-lg font-semibold tracking-tight">
                  More Actions
                </ResponsiveDialogTitle>
              </ResponsiveDialogHeader>

              <div className="px-2 pb-6 pt-0 space-y-0">
                {more.map((item) => (
                  <MutedRow key={item.label} item={item} />
                ))}
              </div>
            </>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {composerOpen && (
        <ClubNewsComposer
          open={composerOpen}
          onOpenChange={(isOpen) => {
            setComposerOpen(isOpen);
            if (!isOpen) setView("main");
          }}
          defaultClubId={activeClubFilter}
        />
      )}
    </>
  );
}
