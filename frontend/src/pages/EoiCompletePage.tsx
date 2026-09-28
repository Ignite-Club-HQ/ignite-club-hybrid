import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, CheckCircle2, PartyPopper, ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClaimEoi, useConfirmEoi, useUpdateMyEoi, type EoiSubmission } from "@/hooks/useMyEois";
import { EOI_STATUS_LABELS } from "@/lib/eoiUtils";
import { toast } from "sonner";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabEoiSubmissions } from "@/lab/fixtureDataLayer";

/**
 * In-app "Complete your EOI" page.
 * Entry: /eoi-complete/:token  (deep link from magic-link email)
 * - If signed out, bounce to /auth and come back
 * - Otherwise: claim the EOI, show prefilled details, allow edit + confirm
 */
export default function EoiCompletePage() {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    const [eoi] = getLocalLabEoiSubmissions("club-icp-001");
    return (
      <div className="container max-w-md mx-auto px-4 py-6 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{eoi.display_name}</CardTitle>
            <CardDescription>{eoi.email}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <Badge variant="outline">{EOI_STATUS_LABELS[eoi.status] ?? eoi.status}</Badge>
            <p className="text-sm text-muted-foreground">
              Showing a synthetic ICP lab EOI record. Editing and confirmation are disabled until identity_access EOI
              claim-linking is wired here.
            </p>
            <Button variant="outline" onClick={() => navigate("/")}>Go to Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabaseEoiCompletePage />;
}

function SupabaseEoiCompletePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const claim = useClaimEoi();
  const update = useUpdateMyEoi();
  const confirm = useConfirmEoi();

  const [extraNotes, setExtraNotes] = useState("");
  const [preferredTeammates, setPreferredTeammates] = useState("");
  const [preferredPosition, setPreferredPosition] = useState("");

  useEffect(() => {
    document.title = "Complete your EOI";
  }, []);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate(`/auth?redirect=${encodeURIComponent(`/eoi-complete/${token}`)}`, {
        replace: true,
      });
    }
  }, [authLoading, user, token, navigate]);

  const { data: eoi, isLoading, refetch } = useQuery({
    queryKey: ["eoi-by-token", token],
    queryFn: async (): Promise<EoiSubmission | null> => {
      if (!token) return null;
      const { data, error } = await supabase.rpc("get_eoi_by_claim_token", { _token: token });
      if (error) throw error;
      return (data as EoiSubmission) ?? null;
    },
    enabled: !!token && !!user,
  });

  // Auto-claim on first visit
  useEffect(() => {
    if (!token || !user || !eoi) return;
    if (eoi.parent_user_id === user.id) return;
    claim.mutate(token, { onSuccess: () => refetch() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id, eoi?.id]);

  useEffect(() => {
    if (!eoi) return;
    setExtraNotes(eoi.extra_notes ?? "");
    setPreferredTeammates(eoi.preferred_teammates ?? "");
    setPreferredPosition(eoi.preferred_position ?? "");
  }, [eoi?.id]);

  const { data: club } = useQuery({
    queryKey: ["eoi-club", eoi?.club_id],
    queryFn: async () => {
      if (!eoi?.club_id) return null;
      const { data } = await supabase
        .from("clubs")
        .select("id, name, logo_url")
        .eq("id", eoi.club_id)
        .maybeSingle();
      return data;
    },
    enabled: !!eoi?.club_id,
  });

  const { data: team } = useQuery({
    queryKey: ["eoi-team", eoi?.assigned_team_id],
    queryFn: async () => {
      if (!eoi?.assigned_team_id) return null;
      const { data } = await supabase
        .from("teams")
        .select("id, name, level_age")
        .eq("id", eoi.assigned_team_id)
        .maybeSingle();
      return data;
    },
    enabled: !!eoi?.assigned_team_id,
  });

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!eoi) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>EOI not found</CardTitle>
            <CardDescription>
              This link may have expired or already been used.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const isAllocated = eoi.status === "allocated" || !!eoi.assigned_team_id;
  const isConfirmed = eoi.status === "confirmed" || eoi.status === "registered";

  const handleSavePrefs = () => {
    update.mutate(
      {
        id: eoi.id,
        patch: {
          extra_notes: extraNotes.trim() || null,
          preferred_teammates: preferredTeammates.trim() || null,
          preferred_position: preferredPosition.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success("Preferences saved");
          refetch();
        },
        onError: (e: any) => toast.error(e.message ?? "Could not save"),
      },
    );
  };

  const handleConfirm = () => {
    confirm.mutate(eoi.id, {
      onSuccess: () => {
        toast.success("Spot confirmed!");
        refetch();
      },
      onError: (e: any) => toast.error(e.message ?? "Could not confirm"),
    });
  };

  return (
    <div className="max-w-lg mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-3">
        {club?.logo_url ? (
          <img
            src={club.logo_url}
            alt={club.name}
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
          <h1 className="text-lg font-semibold truncate">{club?.name}</h1>
        </div>
        <Badge variant="secondary" className="ml-auto capitalize">
          {EOI_STATUS_LABELS[eoi.status] ?? eoi.status}
        </Badge>
      </div>

      {isAllocated && !isConfirmed && team && (
        <Card className="border-primary/50">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <PartyPopper className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <CardTitle className="text-base">
                  {eoi.player_name} has been placed in {team.name}!
                </CardTitle>
                <CardDescription>
                  Confirm your spot to continue to registration.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              size="lg"
              onClick={handleConfirm}
              disabled={confirm.isPending}
            >
              {confirm.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Confirm my spot
            </Button>
          </CardContent>
        </Card>
      )}

      {isConfirmed && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="p-4 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Spot confirmed</p>
              <p className="text-sm text-muted-foreground">
                {team
                  ? `${eoi.player_name} is in ${team.name}.`
                  : "We'll be in touch to finalise registration."}
              </p>
              {eoi.status !== "registered" && (
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => navigate(`/pay-fees/${eoi.club_id}`)}
                >
                  Continue to registration
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Player details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Name" value={eoi.player_name} />
          <Row label="Date of birth" value={eoi.player_dob ?? "—"} />
          {eoi.player_gender && <Row label="Gender" value={eoi.player_gender} />}
          <Row label="Age group" value={eoi.age_group ?? "—"} />
        </CardContent>
      </Card>

      {!isConfirmed && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Add more detail</CardTitle>
            <CardDescription>
              This helps us place {eoi.player_name.split(" ")[0]} with the right group.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="teammates">Preferred teammates</Label>
              <Textarea
                id="teammates"
                value={preferredTeammates}
                onChange={(e) => setPreferredTeammates(e.target.value)}
                placeholder="Who would you like to play with?"
                maxLength={500}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="position">Preferred position</Label>
              <Input
                id="position"
                value={preferredPosition}
                onChange={(e) => setPreferredPosition(e.target.value)}
                maxLength={60}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="notes">Anything else?</Label>
              <Textarea
                id="notes"
                value={extraNotes}
                onChange={(e) => setExtraNotes(e.target.value)}
                placeholder="Injuries, schedule notes, siblings to consider…"
                maxLength={1000}
                className="mt-1"
              />
            </div>
            <Button
              className="w-full"
              variant="outline"
              onClick={handleSavePrefs}
              disabled={update.isPending}
            >
              {update.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Save preferences
            </Button>
          </CardContent>
        </Card>
      )}

      <Button variant="ghost" className="w-full" onClick={() => navigate("/")}>
        Back to Ignite
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-medium text-right truncate">{value}</span>
    </div>
  );
}
