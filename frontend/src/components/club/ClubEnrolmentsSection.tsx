import { BookOpen, Share2 } from "lucide-react";
import { Link } from "react-router-dom";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AdminEnrolmentManager } from "@/components/AdminEnrolmentManager";

interface ClubEnrolmentsSectionProps {
  clubId: string;
  onShareLink: () => void;
}

export function ClubEnrolmentsSection({ clubId, onShareLink }: ClubEnrolmentsSectionProps) {
  return (
    <AccordionItem value="enrolments" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <span className="text-lg font-semibold">Enrolments</span>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="pt-2 space-y-4">
          <AdminEnrolmentManager clubId={clubId} />
          <Card className="border">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <span className="font-medium">Enrolment Page</span>
                  <p className="text-xs text-muted-foreground">Share this link with parents to enrol</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Link to={`/clubs/${clubId}/enrol`} className="flex-1">
                  <Button variant="outline" size="sm" className="w-full gap-1.5">
                    <BookOpen className="h-3.5 w-3.5" />
                    View Page
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={onShareLink}
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Share Link
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
