import { Archive, ArchiveRestore } from "lucide-react";
import { Link } from "react-router-dom";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ArchiveTeamDialog } from "@/components/ArchiveTeamDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface ClubArchivedTeam {
  id: string;
  name: string;
  logo_url?: string | null;
  level_age?: string | null;
  season_label?: string | null;
}

interface ClubArchivedTeamsSectionProps {
  clubId: string;
  archivedTeams: readonly ClubArchivedTeam[];
}

export function ClubArchivedTeamsSection({ clubId, archivedTeams }: ClubArchivedTeamsSectionProps) {
  if (archivedTeams.length === 0) return null;

  return (
    <Accordion type="multiple" defaultValue={[]} className="space-y-4">
      <AccordionItem
        value="archived-teams"
        className="border border-amber-500/30 rounded-lg px-4 bg-amber-50/30 dark:bg-amber-950/10"
      >
        <AccordionTrigger className="hover:no-underline">
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-amber-600" />
            <span className="text-lg font-semibold text-amber-800 dark:text-amber-300">Archived Teams</span>
            <Badge className="ml-2 font-semibold bg-primary/20 text-primary dark:text-primary-foreground dark:bg-primary">
              {archivedTeams.length}
            </Badge>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-3 pt-2">
            {archivedTeams.map((team) => (
              <Card key={team.id} className="border-amber-500/20 bg-amber-50/50 dark:bg-amber-950/10 opacity-80">
                <CardContent className="p-4 flex items-center gap-3">
                  <Link to={`/teams/${team.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                    <Avatar className="h-10 w-10 shrink-0 grayscale">
                      <AvatarImage src={team.logo_url || undefined} />
                      <AvatarFallback className="bg-muted text-muted-foreground">
                        {team.name?.charAt(0)?.toUpperCase() || "T"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-medium truncate text-muted-foreground">{team.name}</h4>
                        <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-700">
                          <Archive className="h-3 w-3 mr-1" />
                          Archived
                        </Badge>
                        {team.season_label && (
                          <Badge variant="secondary" className="text-xs">
                            {team.season_label}
                          </Badge>
                        )}
                      </div>
                      {team.level_age && (
                        <p className="text-xs text-muted-foreground mt-0.5">{team.level_age}</p>
                      )}
                    </div>
                  </Link>
                  <ArchiveTeamDialog
                    teamId={team.id}
                    teamName={team.name}
                    clubId={clubId}
                    isArchived={true}
                    currentSeasonLabel={team.season_label}
                    trigger={
                      <Button variant="outline" size="sm" className="shrink-0">
                        <ArchiveRestore className="h-4 w-4 mr-1" />
                        Reinstate
                      </Button>
                    }
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
