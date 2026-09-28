import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Copy, ExternalLink, ClipboardList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { buildPublicEoiUrl, slugifyClubName } from "@/lib/eoiUtils";

interface Props {
  seasonId: string;
  clubName: string;
  season: {
    eoi_enabled: boolean;
    eoi_slug: string | null;
    eoi_opens_at: string | null;
    eoi_closes_at: string | null;
    eoi_welcome_message: string | null;
    eoi_thank_you_message: string | null;
    eoi_thank_you_redirect_url: string | null;
    eoi_require_dob: boolean;
    eoi_require_gender: boolean;
    eoi_ask_preferences: boolean;
    eoi_ask_availability: boolean;
    eoi_ask_skill_level: boolean;
    eoi_ask_position: boolean;
  };
}

function toDateInput(v: string | null): string {
  if (!v) return "";
  return new Date(v).toISOString().slice(0, 10);
}

export function SeasonEoiConfigCard({ seasonId, clubName, season }: Props) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(season.eoi_enabled);
  const [slug, setSlug] = useState(season.eoi_slug ?? "");
  const [opensAt, setOpensAt] = useState(toDateInput(season.eoi_opens_at));
  const [closesAt, setClosesAt] = useState(toDateInput(season.eoi_closes_at));
  const [welcome, setWelcome] = useState(season.eoi_welcome_message ?? "");
  const [thankYou, setThankYou] = useState(season.eoi_thank_you_message ?? "");
  const [redirectUrl, setRedirectUrl] = useState(season.eoi_thank_you_redirect_url ?? "");
  const [requireDob, setRequireDob] = useState(season.eoi_require_dob);
  const [requireGender, setRequireGender] = useState(season.eoi_require_gender);
  const [askPrefs, setAskPrefs] = useState(season.eoi_ask_preferences);
  const [askAvail, setAskAvail] = useState(season.eoi_ask_availability);
  const [askSkill, setAskSkill] = useState(season.eoi_ask_skill_level);
  const [askPos, setAskPos] = useState(season.eoi_ask_position);

  useEffect(() => {
    setEnabled(season.eoi_enabled);
    setSlug(season.eoi_slug ?? "");
    setOpensAt(toDateInput(season.eoi_opens_at));
    setClosesAt(toDateInput(season.eoi_closes_at));
    setWelcome(season.eoi_welcome_message ?? "");
    setThankYou(season.eoi_thank_you_message ?? "");
    setRedirectUrl(season.eoi_thank_you_redirect_url ?? "");
    setRequireDob(season.eoi_require_dob);
    setRequireGender(season.eoi_require_gender);
    setAskPrefs(season.eoi_ask_preferences);
    setAskAvail(season.eoi_ask_availability);
    setAskSkill(season.eoi_ask_skill_level);
    setAskPos(season.eoi_ask_position);
  }, [seasonId, season]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const finalSlug = slug.trim() || null;
      const payload = {
        eoi_enabled: enabled,
        eoi_slug: finalSlug,
        eoi_opens_at: opensAt ? new Date(opensAt).toISOString() : null,
        eoi_closes_at: closesAt ? new Date(closesAt + "T23:59:59").toISOString() : null,
        eoi_welcome_message: welcome.trim() || null,
        eoi_thank_you_message: thankYou.trim() || null,
        eoi_thank_you_redirect_url: redirectUrl.trim() || null,
        eoi_require_dob: requireDob,
        eoi_require_gender: requireGender,
        eoi_ask_preferences: askPrefs,
        eoi_ask_availability: askAvail,
        eoi_ask_skill_level: askSkill,
        eoi_ask_position: askPos,
      };
      const { error } = await supabase.from("seasons").update(payload).eq("id", seasonId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("EOI settings saved");
      qc.invalidateQueries({ queryKey: ["season", seasonId] });
    },
    onError: (e: Error) => {
      if (e.message.includes("seasons_club_eoi_slug_uq")) {
        toast.error("That URL slug is already used on another season in this club");
      } else {
        toast.error(e.message);
      }
    },
  });

  const publicUrl = slug ? buildPublicEoiUrl(clubName, slug) : null;
  const canSave = !enabled || slug.trim().length > 0;

  const copyUrl = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardList className="h-4 w-4" /> Expressions of Interest
        </CardTitle>
        <CardDescription>
          Capture interest from parents via your website before registration opens.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="eoi-enabled" className="flex flex-col">
            <span>EOI form is live</span>
            <span className="text-xs text-muted-foreground font-normal">
              Parents can submit via the public link below
            </span>
          </Label>
          <Switch id="eoi-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div>
          <Label htmlFor="eoi-slug">Public URL slug</Label>
          <Input
            id="eoi-slug"
            value={slug}
            onChange={(e) => setSlug(slugifyClubName(e.target.value))}
            placeholder="winter-2027"
            className="mt-1"
          />
          {publicUrl && (
            <div className="mt-2 flex items-center gap-2 text-xs bg-muted rounded-md p-2">
              <code className="flex-1 truncate text-foreground">{publicUrl}</code>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={copyUrl} type="button">
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => window.open(publicUrl, "_blank")}
                type="button"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="eoi-opens">Opens</Label>
            <Input
              id="eoi-opens"
              type="date"
              value={opensAt}
              onChange={(e) => setOpensAt(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="eoi-closes">Closes</Label>
            <Input
              id="eoi-closes"
              type="date"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="eoi-welcome">Welcome message</Label>
          <Textarea
            id="eoi-welcome"
            value={welcome}
            onChange={(e) => setWelcome(e.target.value)}
            placeholder="Shown at the top of the form."
            maxLength={500}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="eoi-thanks">Thank-you message</Label>
          <Textarea
            id="eoi-thanks"
            value={thankYou}
            onChange={(e) => setThankYou(e.target.value)}
            placeholder="Shown after submission (ignored if redirect URL is set)."
            maxLength={500}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="eoi-redirect">Custom thank-you redirect (optional)</Label>
          <Input
            id="eoi-redirect"
            type="url"
            value={redirectUrl}
            onChange={(e) => setRedirectUrl(e.target.value)}
            placeholder="https://reference.invalid"
            className="mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            If set, parents are sent to this URL after submitting instead of the default thank-you screen.
          </p>
        </div>

        <div className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">Form fields</p>
          {[
            { id: "req-dob", label: "Require date of birth", val: requireDob, set: setRequireDob },
            { id: "req-gender", label: "Require gender", val: requireGender, set: setRequireGender },
            { id: "ask-prefs", label: "Ask for preferred teammates", val: askPrefs, set: setAskPrefs },
            { id: "ask-avail", label: "Ask about availability", val: askAvail, set: setAskAvail },
            { id: "ask-skill", label: "Ask about skill level", val: askSkill, set: setAskSkill },
            { id: "ask-pos", label: "Ask for preferred position", val: askPos, set: setAskPos },
          ].map((f) => (
            <div key={f.id} className="flex items-center justify-between">
              <Label htmlFor={f.id} className="text-sm font-normal">{f.label}</Label>
              <Switch id={f.id} checked={f.val} onCheckedChange={f.set} />
            </div>
          ))}
        </div>

        <Button
          className="w-full"
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || !canSave}
        >
          {saveMut.isPending ? "Saving..." : "Save EOI settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
