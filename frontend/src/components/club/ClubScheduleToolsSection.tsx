import { CalendarDays, Crown, FileSpreadsheet } from "lucide-react";
import { Link } from "react-router-dom";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

interface ClubScheduleToolsSectionProps {
  hasImportProAccess: boolean;
  onUpgradeClick: () => void;
}

export function ClubScheduleToolsSection({ hasImportProAccess, onUpgradeClick }: ClubScheduleToolsSectionProps) {
  return (
    <AccordionItem value="schedule-tools" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-muted-foreground" />
          <span className="text-lg font-semibold">Schedule tools</span>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        {hasImportProAccess ? (
          <Link to="/events/import" className="block pb-2">
            <div className="flex items-center gap-3 py-2">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <span className="text-sm font-medium">Import Fixtures</span>
                <p className="text-xs text-muted-foreground">From CSV or Excel</p>
              </div>
            </div>
          </Link>
        ) : (
          <button type="button" className="w-full text-left pb-2" onClick={onUpgradeClick}>
            <div className="flex items-center gap-3 py-2">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <span className="text-sm font-medium text-muted-foreground">Import Fixtures</span>
                <p className="text-xs text-muted-foreground">Available on Pro</p>
              </div>
              <Badge variant="secondary" className="text-xs gap-1 ml-auto">
                <Crown className="h-3 w-3" />
                Pro
              </Badge>
            </div>
          </button>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
