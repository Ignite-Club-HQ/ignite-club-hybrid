import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card } from "@/components/ui/card";
import {
  ChevronDown,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  Shield,
  ShieldCheck,
  ShoppingBag,
  ClipboardList,
  CreditCard,
  Calendar,
  Info,
  Users,
  Trophy,
  HeartHandshake,
} from "lucide-react";
import { useClubTheme } from "@/hooks/useClubTheme";
import { useClubQuickLinks, useClubPolicyDocs } from "@/features/clubLinks/useClubQuickLinks";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { safeOpenFile } from "@/lib/safeOpenFile";
import { toast } from "@/hooks/use-toast";

const OPEN_STATE_KEY = "ignite_home_club_links_open";

export const CLUB_LINK_ICONS: Record<string, typeof LinkIcon> = {
  link: LinkIcon,
  policy: Shield,
  safety: ShieldCheck,
  clothing: ShoppingBag,
  registration: ClipboardList,
  payment: CreditCard,
  calendar: Calendar,
  info: Info,
  members: Users,
  results: Trophy,
  volunteer: HeartHandshake,
  document: FileText,
};

function iconFor(key: string | null | undefined) {
  return CLUB_LINK_ICONS[(key || "link").toLowerCase()] || LinkIcon;
}

interface Tile {
  id: string;
  title: string;
  subtitle?: string | null;
  Icon: typeof LinkIcon;
  onOpen: () => void | Promise<void>;
}

/**
 * Home page "Club Info & Links" tile grid — club-managed quick links plus any
 * documents in a club Vault policies folder. Renders nothing when the viewer's
 * clubs expose no links or policy documents.
 */
export default function ClubLinksSection() {
  const navigate = useNavigate();
  const { activeClubFilter } = useClubTheme();
  const { data: links = [] } = useClubQuickLinks(activeClubFilter);
  const { data: policies = [] } = useClubPolicyDocs(activeClubFilter);

  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_STATE_KEY) !== "closed";
    } catch {
      return true;
    }
  });

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_STATE_KEY, next ? "open" : "closed");
    } catch {
      /* storage unavailable — state stays in-memory only */
    }
  };

  const tiles = useMemo<Tile[]>(() => {
    const linkTiles: Tile[] = links.map((link) => ({
      id: `link-${link.id}`,
      title: link.title,
      subtitle: link.subtitle,
      Icon: iconFor(link.icon),
      onOpen: async () => {
        if (link.open_mode === "embed") {
          navigate(`/club-link/${link.id}`);
          return;
        }
        try {
          await safeOpenUrl(link.url);
        } catch {
          toast({
            title: "Couldn't open link",
            description: "Please try again in a moment.",
            variant: "destructive",
          });
        }
      },
    }));

    const policyTiles: Tile[] = policies.map((doc) => ({
      id: `doc-${doc.id}`,
      title: doc.name,
      subtitle: "Club document",
      Icon: FileText,
      onOpen: async () => {
        try {
          if (doc.is_external_link) {
            await safeOpenUrl(doc.file_url);
          } else {
            await safeOpenFile(doc.file_url, { fileName: doc.name });
          }
        } catch {
          toast({
            title: "Couldn't open document",
            description: "Please try again in a moment.",
            variant: "destructive",
          });
        }
      },
    }));

    return [...linkTiles, ...policyTiles];
  }, [links, policies, navigate]);

  if (tiles.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-1 py-1 text-left">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">Club Info &amp; Links</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {tiles.length}
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="pt-2">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {tiles.map((tile) => (
            <Card
              key={tile.id}
              role="button"
              tabIndex={0}
              onClick={() => void tile.onOpen()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void tile.onOpen();
                }
              }}
              className="flex cursor-pointer flex-col items-center gap-1.5 bg-card p-3 text-center transition-colors hover:bg-accent/50 active:bg-accent"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <tile.Icon className="h-4 w-4" />
              </span>
              <span className="line-clamp-2 text-[11px] font-medium leading-tight text-foreground">
                {tile.title}
              </span>
              {tile.subtitle && (
                <span className="line-clamp-1 text-[10px] text-muted-foreground">
                  {tile.subtitle}
                </span>
              )}
            </Card>
          ))}
        </div>
        <p className="mt-2 flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
          <ExternalLink className="h-3 w-3" /> Some links open your club&apos;s website
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
