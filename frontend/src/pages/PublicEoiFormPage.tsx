import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, CheckCircle2, ClipboardList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { WEEKDAYS } from "@/lib/eoiUtils";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

type EoiConfig = {
  season_id: string;
  season_name: string;
  club_id: string;
  club_name: string;
  club_logo_url: string | null;
  is_open: boolean;
  opens_at: string | null;
  closes_at: string | null;
  welcome_message: string | null;
  thank_you_message: string | null;
  thank_you_redirect_url: string | null;
  require_dob: boolean;
  require_gender: boolean;
  ask_preferences: boolean;
  ask_availability: boolean;
  ask_skill_level: boolean;
  ask_position: boolean;
};

export default function PublicEoiFormPage() {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return (
      <div className="container max-w-md mx-auto px-4 py-6 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>ICP Lab Association</CardTitle>
            <CardDescription>ICP Test Club — synthetic expression-of-interest form</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-center">
            <ClipboardList className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Showing a synthetic ICP lab EOI configuration. Submitting an expression of interest is disabled until an
              ICP domain service is connected.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabasePublicEoiFormPage />;
}

function SupabasePublicEoiFormPage() {
  const { clubSlug, seasonSlug } = useParams<{ clubSlug: string; seasonSlug: string }>();

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<EoiConfig | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentMobile, setParentMobile] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [playerDob, setPlayerDob] = useState("");
  const [playerGender, setPlayerGender] = useState("");
  const [preferredTeammates, setPreferredTeammates] = useState("");
  const [preferredPosition, setPreferredPosition] = useState("");
  const [skillLevel, setSkillLevel] = useState<number | null>(null);
  const [trainingDays, setTrainingDays] = useState<string[]>([]);
  const [gameDays, setGameDays] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    document.title = "Express Interest";
  }, []);

  useEffect(() => {
    if (!clubSlug || !seasonSlug) return;
    (async () => {
      const { data, error } = await supabase.rpc("get_public_eoi_config", {
        _club_slug: clubSlug,
        _season_slug: seasonSlug,
      });
      if (error) {
        console.error(error);
        toast.error("Could not load form");
      }
      const row = (data as EoiConfig[] | null)?.[0] ?? null;
      setConfig(row);
      if (row) {
        document.title = `EOI · ${row.club_name}`;
        // Fire-and-forget view tracking (best effort)
        const isEmbed = typeof window !== "undefined" && window.parent !== window;
        supabase
          .from("eoi_form_views")
          .insert({
            season_id: row.season_id,
            club_id: row.club_id,
            source: isEmbed ? "embed" : "website",
          })
          .then(({ error: viewErr }) => {
            if (viewErr) console.warn("[eoi] view tracking failed", viewErr);
          });
      }
      setLoading(false);
    })();
  }, [clubSlug, seasonSlug]);

  const toggleDay = (list: string[], setList: (v: string[]) => void, day: string) => {
    setList(list.includes(day) ? list.filter((d) => d !== day) : [...list, day]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    if (!parentName.trim() || !parentEmail.trim() || !playerName.trim()) {
      toast.error("Please fill in the required fields");
      return;
    }
    if (config.require_dob && !playerDob) {
      toast.error("Player date of birth is required");
      return;
    }
    if (config.require_gender && !playerGender) {
      toast.error("Player gender is required");
      return;
    }

    setSubmitting(true);
    const { data: inserted, error } = await supabase
      .from("eoi_submissions")
      .insert({
        club_id: config.club_id,
        season_id: config.season_id,
        parent_name: parentName.trim(),
        parent_email: parentEmail.trim().toLowerCase(),
        parent_mobile: parentMobile.trim() || null,
        player_name: playerName.trim(),
        player_dob: playerDob || null,
        player_gender: playerGender || null,
        preferred_teammates: preferredTeammates.trim() || null,
        preferred_position: preferredPosition.trim() || null,
        skill_level: skillLevel,
        training_days: trainingDays,
        game_days: gameDays,
        notes: notes.trim() || null,
        source: "website",
        status: "submitted",
      })
      .select("id")
      .single();

    if (error) {
      setSubmitting(false);
      console.error(error);
      toast.error("Submission failed. Please try again.");
      return;
    }

    // Fire the magic-link invite — best effort, don't block the thank-you screen.
    if (inserted?.id) {
      supabase.functions
        .invoke("send-eoi-invite", { body: { submission_id: inserted.id } })
        .catch((e) => console.warn("[eoi] invite send failed", e));
    }

    setSubmitting(false);

    // Custom thank-you redirect if club configured one
    if (config.thank_you_redirect_url) {
      try {
        const url = new URL(config.thank_you_redirect_url);
        window.location.href = url.toString();
        return;
      } catch {
        // invalid URL — fall through to default thank-you screen
      }
    }

    setSubmitted(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Form not found</CardTitle>
            <CardDescription>
              This Expression of Interest link doesn't exist or is no longer available.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!config.is_open) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            {config.club_logo_url && (
              <img
                src={config.club_logo_url}
                alt={config.club_name}
                className="h-14 w-14 rounded-full object-contain mb-3"
              />
            )}
            <CardTitle>{config.club_name}</CardTitle>
            <CardDescription>
              EOIs for {config.season_name} are not open right now.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex flex-col items-center text-center">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                <CheckCircle2 className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>Thanks, {parentName.split(" ")[0] || "there"}!</CardTitle>
              <CardDescription className="mt-2">
                {config.thank_you_message ??
                  `We've got your Expression of Interest for ${config.season_name}. ${config.club_name} will be in touch.`}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setSubmitted(false);
                setPlayerName("");
                setPlayerDob("");
                setPlayerGender("");
                setPreferredTeammates("");
                setPreferredPosition("");
                setSkillLevel(null);
                setTrainingDays([]);
                setGameDays([]);
                setNotes("");
              }}
            >
              Submit another player
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          {config.club_logo_url ? (
            <img
              src={config.club_logo_url}
              alt={config.club_name}
              className="h-12 w-12 rounded-full object-contain bg-muted"
            />
          ) : (
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <ClipboardList className="h-6 w-6 text-primary" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Expression of Interest
            </p>
            <h1 className="text-lg font-semibold truncate">
              {config.club_name} · {config.season_name}
            </h1>
          </div>
        </div>

        {config.welcome_message && (
          <Card>
            <CardContent className="p-4 text-sm whitespace-pre-line">
              {config.welcome_message}
            </CardContent>
          </Card>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Parent */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Parent / guardian</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="p-name">Your name *</Label>
                <Input
                  id="p-name"
                  value={parentName}
                  onChange={(e) => setParentName(e.target.value)}
                  maxLength={100}
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="p-email">Email *</Label>
                <Input
                  id="p-email"
                  type="email"
                  value={parentEmail}
                  onChange={(e) => setParentEmail(e.target.value)}
                  maxLength={255}
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="p-mobile">Mobile</Label>
                <Input
                  id="p-mobile"
                  type="tel"
                  value={parentMobile}
                  onChange={(e) => setParentMobile(e.target.value)}
                  maxLength={30}
                  className="mt-1"
                />
              </div>
            </CardContent>
          </Card>

          {/* Player */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Player</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="pl-name">Player name *</Label>
                <Input
                  id="pl-name"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  maxLength={100}
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="pl-dob">
                  Date of birth {config.require_dob && "*"}
                </Label>
                <Input
                  id="pl-dob"
                  type="date"
                  value={playerDob}
                  onChange={(e) => setPlayerDob(e.target.value)}
                  required={config.require_dob}
                  className="mt-1"
                />
              </div>
              {config.require_gender && (
                <div>
                  <Label htmlFor="pl-gender">Gender *</Label>
                  <Input
                    id="pl-gender"
                    value={playerGender}
                    onChange={(e) => setPlayerGender(e.target.value)}
                    maxLength={30}
                    required
                    className="mt-1"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Preferences */}
          {(config.ask_preferences || config.ask_skill_level || config.ask_position) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Preferences</CardTitle>
                <CardDescription>Best effort — we can't guarantee these.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {config.ask_preferences && (
                  <div>
                    <Label htmlFor="pr-team">Preferred teammates</Label>
                    <Textarea
                      id="pr-team"
                      value={preferredTeammates}
                      onChange={(e) => setPreferredTeammates(e.target.value)}
                      placeholder="Who would you like to play with?"
                      maxLength={500}
                      className="mt-1"
                    />
                  </div>
                )}
                {config.ask_position && (
                  <div>
                    <Label htmlFor="pr-pos">Preferred position</Label>
                    <Input
                      id="pr-pos"
                      value={preferredPosition}
                      onChange={(e) => setPreferredPosition(e.target.value)}
                      maxLength={60}
                      className="mt-1"
                    />
                  </div>
                )}
                {config.ask_skill_level && (
                  <div>
                    <Label>Skill level</Label>
                    <div className="flex gap-2 mt-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Button
                          type="button"
                          key={n}
                          variant={skillLevel === n ? "default" : "outline"}
                          size="sm"
                          className="flex-1"
                          onClick={() => setSkillLevel(skillLevel === n ? null : n)}
                        >
                          {n}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      1 = beginner · 5 = advanced
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Availability */}
          {config.ask_availability && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Availability</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm font-medium mb-2">Training days</p>
                  <div className="grid grid-cols-4 gap-2">
                    {WEEKDAYS.map((d) => (
                      <label
                        key={`t-${d.value}`}
                        className="flex items-center gap-1.5 text-sm cursor-pointer"
                      >
                        <Checkbox
                          checked={trainingDays.includes(d.value)}
                          onCheckedChange={() =>
                            toggleDay(trainingDays, setTrainingDays, d.value)
                          }
                        />
                        {d.short}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Game days</p>
                  <div className="grid grid-cols-4 gap-2">
                    {WEEKDAYS.map((d) => (
                      <label
                        key={`g-${d.value}`}
                        className="flex items-center gap-1.5 text-sm cursor-pointer"
                      >
                        <Checkbox
                          checked={gameDays.includes(d.value)}
                          onCheckedChange={() => toggleDay(gameDays, setGameDays, d.value)}
                        />
                        {d.short}
                      </label>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4">
              <Label htmlFor="notes">Anything else?</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Injuries, schedule notes, etc."
                maxLength={1000}
                className="mt-1"
              />
            </CardContent>
          </Card>

          <Button type="submit" className="w-full" size="lg" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Submit Expression of Interest
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            No account needed. We'll email you if you need to complete registration.
          </p>
        </form>
      </div>
    </div>
  );
}
