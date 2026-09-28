import type { ComponentProps } from "react";
import { Palette } from "lucide-react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { ClubThemeEditor } from "@/components/ClubThemeEditor";

type ClubThemeEditorProps = ComponentProps<typeof ClubThemeEditor>;

interface ClubBrandingSectionProps extends Omit<ClubThemeEditorProps, "onSave"> {
  hasProAccess: boolean;
  onSaved: () => void;
}

export function ClubBrandingSection({ hasProAccess, onSaved, ...editorProps }: ClubBrandingSectionProps) {
  return (
    <AccordionItem value="branding" data-section-anchor="branding" className="border rounded-lg px-4 scroll-mt-20">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-primary" />
          <span className="text-lg font-semibold">Club Branding</span>
          {!hasProAccess && (
            <Badge variant="outline" className="text-xs font-normal ml-2">Configure now, activates on Pro</Badge>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="pt-2 space-y-3">
          {!hasProAccess && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
              You can configure your club colours and logo now, but branding will only be applied across the app once your club is on the <strong>Pro</strong> plan. Your saved settings will activate automatically when you upgrade or start a trial.
            </div>
          )}
          <ClubThemeEditor {...editorProps} onSave={onSaved} />
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
