import { useNavigate } from "react-router-dom";
import { ArrowLeft, Type, Contrast, Sparkles, Bold, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  TEXT_SCALE_STEPS,
  useAccessibilityPrefs,
} from "@/hooks/useAccessibilityPrefs";

export default function AccessibilitySettingsPage() {
  usePageTitle("Accessibility");
  const navigate = useNavigate();
  const { prefs, setPrefs, reset } = useAccessibilityPrefs();

  const currentStepIdx = Math.max(
    0,
    TEXT_SCALE_STEPS.findIndex((s) => Math.abs(s.value - prefs.textScale) < 0.001)
  );

  return (
    <div className="container max-w-2xl mx-auto p-4 space-y-4 pb-24">
      <div className="flex items-center gap-2 mb-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">Accessibility</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Type className="h-5 w-5" />
            Text size
          </CardTitle>
          <CardDescription>
            Make text across the app easier to read. Changes apply instantly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-4">
            <p className="text-sm text-muted-foreground mb-1">Preview</p>
            <p className="font-semibold">The quick brown fox jumps over the lazy dog.</p>
            <p className="text-sm text-muted-foreground mt-1">
              This is how body text will look on every page.
            </p>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {TEXT_SCALE_STEPS.map((step, idx) => {
              const active = idx === currentStepIdx;
              return (
                <Button
                  key={step.label}
                  variant={active ? "default" : "outline"}
                  className="flex flex-col h-auto py-3"
                  onClick={() => setPrefs({ textScale: step.value })}
                  aria-pressed={active}
                  aria-label={`Text size ${step.label}`}
                >
                  <span style={{ fontSize: `${0.75 + idx * 0.12}rem` }}>A</span>
                  <span className="text-[10px] mt-1 opacity-80">{step.label}</span>
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Display & motion
          </CardTitle>
          <CardDescription>Tune visuals to suit your eyes and comfort.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="hc" className="flex items-center gap-2 font-medium">
                <Contrast className="h-4 w-4" /> High contrast
              </Label>
              <p className="text-xs text-muted-foreground">
                Strengthens text and borders for better legibility.
              </p>
            </div>
            <Switch
              id="hc"
              checked={prefs.highContrast}
              onCheckedChange={(v) => setPrefs({ highContrast: v })}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="bt" className="flex items-center gap-2 font-medium">
                <Bold className="h-4 w-4" /> Bold text
              </Label>
              <p className="text-xs text-muted-foreground">
                Thickens body text for easier reading.
              </p>
            </div>
            <Switch
              id="bt"
              checked={prefs.boldText}
              onCheckedChange={(v) => setPrefs({ boldText: v })}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="rm" className="flex items-center gap-2 font-medium">
                <Sparkles className="h-4 w-4" /> Reduce motion
              </Label>
              <p className="text-xs text-muted-foreground">
                Disables typewriter effects, auto-advancing carousels and non-essential transitions.
              </p>
            </div>
            <Switch
              id="rm"
              checked={prefs.reduceMotion}
              onCheckedChange={(v) => setPrefs({ reduceMotion: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Button variant="outline" className="w-full" onClick={reset}>
        <RotateCcw className="h-4 w-4 mr-2" />
        Reset to defaults
      </Button>
    </div>
  );
}
