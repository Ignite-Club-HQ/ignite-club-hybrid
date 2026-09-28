import { ChevronRight, Plus, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface ClubMiniLeague {
  id: string;
  name: string;
  description?: string | null;
}

interface ClubMiniLeaguesSectionProps {
  clubId: string;
  isAdmin: boolean;
  miniLeagues: readonly ClubMiniLeague[];
}

export function ClubMiniLeaguesSection({ clubId, isAdmin, miniLeagues }: ClubMiniLeaguesSectionProps) {
  return (
    <Accordion type="multiple" defaultValue={[]} className="space-y-4">
      <AccordionItem value="mini-leagues" className="border rounded-lg px-4">
        <AccordionTrigger className="hover:no-underline">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            <span className="text-lg font-semibold">Mini Leagues</span>
            {miniLeagues.length > 0 && (
              <Badge className="ml-2 font-semibold bg-primary/20 text-primary dark:text-primary-foreground dark:bg-primary">
                {miniLeagues.length}
              </Badge>
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-3 pt-2">
            {isAdmin && (
              <div className="flex justify-end">
                <Link to={`/mini-leagues?clubId=${clubId}`}>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" /> New Mini League
                  </Button>
                </Link>
              </div>
            )}
            {miniLeagues.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">
                No mini leagues yet. Create one to organize ability-based sessions.
              </p>
            ) : (
              miniLeagues.map((league) => (
                <Link key={league.id} to={`/mini-leagues/${league.id}`}>
                  <Card className="hover:bg-muted/50 transition-colors">
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <Trophy className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{league.name}</p>
                          {league.description && (
                            <p className="text-sm text-muted-foreground line-clamp-1">
                              {league.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </CardContent>
                  </Card>
                </Link>
              ))
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
