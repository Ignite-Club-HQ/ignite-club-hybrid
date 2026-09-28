import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { CalendarCheck, ClipboardList, Trophy, MessageCircle, Camera, Flame, Sparkles } from "lucide-react";

interface PointsHowToEarnSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pointsLabel?: string;
}

const EARN_METHODS = [
  {
    icon: CalendarCheck,
    title: "RSVP early",
    desc: "Respond to events before the deadline.",
  },
  {
    icon: ClipboardList,
    title: "Complete duties",
    desc: "Volunteer for match-day or event roles.",
  },
  {
    icon: Trophy,
    title: "Player of the Match",
    desc: "Get nominated by your coach or team.",
  },
  {
    icon: MessageCircle,
    title: "Stay engaged",
    desc: "Chat and react in your team and club threads.",
  },
  {
    icon: Camera,
    title: "Share moments",
    desc: "Upload and comment on team photos.",
  },
  {
    icon: Flame,
    title: "Build streaks",
    desc: "Keep weekly engagement going for bonus points.",
  },
];

export default function PointsHowToEarnSheet({
  open,
  onOpenChange,
  pointsLabel = "Reward Points",
}: PointsHowToEarnSheetProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            How to earn {pointsLabel}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Stay active with your club to unlock rewards faster.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="px-1 py-2 space-y-2">
          {EARN_METHODS.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="flex items-start gap-3 rounded-lg border bg-card p-3"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-tight">{title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground text-center pt-2">
            Exact point amounts are set by your club admin.
          </p>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
