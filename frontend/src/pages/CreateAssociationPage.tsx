import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useUserHasAnyClubPro } from "@/hooks/useUserHasAnyClubPro";
import { ProFeatureLock } from "@/components/subscription/ProFeatureLock";
import { cn } from "@/lib/utils";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

export default function CreateAssociationPage() {
  const navigate = useNavigate();
  usePageTitle("New association");
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return (
      <div className="container max-w-xl mx-auto px-4 py-10">
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-4 text-center">
          <Info className="h-10 w-10 mx-auto text-muted-foreground" />
          <h1 className="text-lg font-semibold">Preview only</h1>
          <p className="text-sm text-muted-foreground">
            Association creation is a local preview in ICP lab mode; no data is persisted until an
            association_domain service is built and wired here.
          </p>
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Go back
          </Button>
        </div>
      </div>
    );
  }

  return <SupabaseCreateAssociationPage />;
}

function SupabaseCreateAssociationPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { hasAnyClubPro, isLoading: proLoading } = useUserHasAnyClubPro();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const [descFocused, setDescFocused] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);

  const submit = async () => {
    if (!name.trim() || !user) return;
    setSaving(true);
    const { data: club, error } = await supabase
      .from("clubs")
      .insert({ name: name.trim(), description: description.trim() || null, kind: "association" })
      .select("id")
      .single();
    if (error || !club) {
      setSaving(false);
      toast({ title: "Could not create association", description: error?.message, variant: "destructive" });
      return;
    }
    const { error: roleErr } = await supabase.from("user_roles").insert({
      user_id: user.id,
      club_id: club.id,
      role: "association_admin",
    });
    setSaving(false);
    if (roleErr) {
      toast({ title: "Created, but couldn't assign admin role", description: roleErr.message, variant: "destructive" });
    }
    toast({ title: "Association created" });
    navigate(`/associations/${club.id}`);
  };

  const handleDescInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  return (
    <div className="min-h-full bg-background">
      {/* Compact header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-none border-b border-border/60">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center justify-center -ml-2 w-9 h-9 rounded-full hover:bg-accent transition-colors active:scale-95"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold leading-tight truncate">New Association</h1>
            <p className="text-[11px] text-muted-foreground leading-tight truncate">Link multiple clubs under one organisation</p>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 pt-4 pb-8 space-y-4">
        {!proLoading && !hasAnyClubPro ? (
          <ProFeatureLock
            title="Associations is a Pro feature"
            description="Federations and umbrella bodies require an active Pro club. Upgrade to unlock."
            showUpgradeButton={false}
          />
        ) : (
          <>
            {/* Form card */}
            <div className="rounded-2xl bg-card border border-border/50 shadow-sm p-6 space-y-5">
              {/* Floating label: Name */}
              <div className="relative">
                <input
                  id="assoc-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  placeholder=" "
                  className={cn(
                    "peer w-full rounded-xl border bg-background px-4 pt-5 pb-2 text-sm text-foreground outline-none transition-all",
                    "focus:border-primary focus:ring-2 focus:ring-primary/20",
                    nameFocused || name.trim() ? "border-primary/70" : "border-input"
                  )}
                />
                <label
                  htmlFor="assoc-name"
                  className={cn(
                    "absolute left-4 transition-all pointer-events-none text-muted-foreground",
                    nameFocused || name.trim()
                      ? "top-1.5 text-[10px] font-medium text-primary"
                      : "top-3.5 text-sm"
                  )}
                >
                  Association Name
                </label>
              </div>

              {/* Floating label: Description */}
              <div className="relative">
                <textarea
                  ref={descRef}
                  id="assoc-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onFocus={() => setDescFocused(true)}
                  onBlur={() => setDescFocused(false)}
                  onInput={handleDescInput}
                  placeholder=" "
                  rows={2}
                  className={cn(
                    "peer w-full rounded-xl border bg-background px-4 pt-5 pb-2 text-sm text-foreground outline-none transition-all resize-none overflow-hidden",
                    "focus:border-primary focus:ring-2 focus:ring-primary/20",
                    descFocused || description.trim() ? "border-primary/70" : "border-input"
                  )}
                />
                <label
                  htmlFor="assoc-desc"
                  className={cn(
                    "absolute left-4 transition-all pointer-events-none text-muted-foreground",
                    descFocused || description.trim()
                      ? "top-1.5 text-[10px] font-medium text-primary"
                      : "top-3.5 text-sm"
                  )}
                >
                  Description
                </label>
              </div>

              {/* Submit button */}
              <Button
                onClick={submit}
                disabled={!name.trim() || saving}
                className="w-full h-14 text-base font-semibold rounded-xl active:scale-[0.97] transition-transform"
              >
                {saving ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  "Create Association"
                )}
              </Button>
            </div>

            {/* Info card */}
            <div className="rounded-2xl bg-accent/40 border border-border/40 p-4 flex items-start gap-3">
              <div className="mt-0.5 shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Info className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">How it works</p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                  Create an association first, then link clubs through{" "}
                  <span className="font-medium text-foreground">Club Settings → Parent Organisation</span>.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
