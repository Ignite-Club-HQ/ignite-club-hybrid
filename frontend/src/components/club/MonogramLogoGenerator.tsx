import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Sparkles, Circle, Square } from "lucide-react";
import { toast } from "sonner";

/**
 * Monogram logo generator — renders a club's initials to a canvas with a
 * chosen colour + shape, uploads the PNG to `club-logos`, and writes the
 * resulting public URL onto `clubs.logo_url`. Meant for the branding step
 * of the setup wizard when a club has no real logo yet.
 */

interface MonogramLogoGeneratorProps {
  clubId: string;
  clubName: string;
  onGenerated?: (logoUrl: string) => void;
}

const PRESETS: { label: string; bg: string; fg: string }[] = [
  { label: "Ignite", bg: "#F97316", fg: "#FFFFFF" },
  { label: "Royal", bg: "#1D4ED8", fg: "#FFFFFF" },
  { label: "Forest", bg: "#166534", fg: "#FFFFFF" },
  { label: "Crimson", bg: "#B91C1C", fg: "#FFFFFF" },
  { label: "Slate", bg: "#0F172A", fg: "#FFFFFF" },
  { label: "Gold", bg: "#EAB308", fg: "#0F172A" },
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "C";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function MonogramLogoGenerator({
  clubId,
  clubName,
  onGenerated,
}: MonogramLogoGeneratorProps) {
  const [initials, setInitials] = useState(() => getInitials(clubName));
  const [bg, setBg] = useState(PRESETS[0].bg);
  const [fg, setFg] = useState(PRESETS[0].fg);
  const [shape, setShape] = useState<"circle" | "square">("circle");
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const previewStyle = useMemo(
    () => ({
      background: bg,
      color: fg,
      borderRadius: shape === "circle" ? "9999px" : "18%",
    }),
    [bg, fg, shape],
  );

  const drawToCanvas = () => {
    const canvas = canvasRef.current!;
    const size = 512;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = bg;
    if (shape === "circle") {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const r = size * 0.18;
      const w = size;
      const h = size;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.arcTo(w, 0, w, h, r);
      ctx.arcTo(w, h, 0, h, r);
      ctx.arcTo(0, h, 0, 0, r);
      ctx.arcTo(0, 0, w, 0, r);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = fg;
    ctx.font = `bold ${size * (initials.length > 1 ? 0.44 : 0.56)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials.toUpperCase().slice(0, 3), size / 2, size / 2 + size * 0.03);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      drawToCanvas();
      const blob = await new Promise<Blob | null>((resolve) =>
        canvasRef.current!.toBlob((b) => resolve(b), "image/png", 0.95),
      );
      if (!blob) throw new Error("Could not render monogram");

      const fileName = `${clubId}/monogram-${Date.now()}.png`;
      const { error: upErr } = await supabase.storage
        .from("club-logos")
        .upload(fileName, blob, { upsert: true, contentType: "image/png" });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage
        .from("club-logos")
        .getPublicUrl(fileName);
      const logoUrl = urlData.publicUrl;

      const { error: updErr } = await supabase
        .from("clubs")
        .update({ logo_url: logoUrl })
        .eq("id", clubId);
      if (updErr) throw updErr;

      toast.success("Monogram logo saved", {
        description: "You can replace it with a real logo anytime.",
      });
      onGenerated?.(logoUrl);
    } catch (e: any) {
      console.error("Monogram save failed:", e);
      toast.error("Could not save monogram", { description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Quick monogram</p>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          No logo yet? Generate a clean monogram in seconds. You can replace it later.
        </p>

        <div className="flex items-center gap-4">
          <div
            className="h-20 w-20 shrink-0 flex items-center justify-center text-2xl font-bold"
            style={previewStyle}
          >
            {initials.toUpperCase().slice(0, 3)}
          </div>
          <div className="flex-1 space-y-2">
            <Label htmlFor="mono-initials" className="text-xs">Initials</Label>
            <Input
              id="mono-initials"
              value={initials}
              maxLength={3}
              onChange={(e) => setInitials(e.target.value.replace(/[^A-Za-z0-9]/g, ""))}
              className="h-9"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Colour</Label>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setBg(p.bg);
                  setFg(p.fg);
                }}
                aria-label={p.label}
                className={`h-9 w-9 rounded-full border-2 transition ${
                  bg === p.bg ? "border-foreground scale-110" : "border-transparent"
                }`}
                style={{ background: p.bg }}
              />
            ))}
            <label className="h-9 w-9 rounded-full border-2 border-dashed border-muted-foreground/40 flex items-center justify-center cursor-pointer overflow-hidden">
              <input
                type="color"
                value={bg}
                onChange={(e) => setBg(e.target.value)}
                className="opacity-0 absolute w-9 h-9 cursor-pointer"
              />
              <span className="text-[10px] text-muted-foreground">Custom</span>
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Shape</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={shape === "circle" ? "default" : "outline"}
              onClick={() => setShape("circle")}
            >
              <Circle className="h-4 w-4 mr-1" /> Circle
            </Button>
            <Button
              type="button"
              size="sm"
              variant={shape === "square" ? "default" : "outline"}
              onClick={() => setShape("square")}
            >
              <Square className="h-4 w-4 mr-1" /> Rounded
            </Button>
          </div>
        </div>

        <Button
          type="button"
          onClick={handleSave}
          disabled={saving || !initials.trim()}
          className="w-full"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…
            </>
          ) : (
            "Use this monogram as club logo"
          )}
        </Button>

        <canvas ref={canvasRef} className="hidden" aria-hidden />
      </CardContent>
    </Card>
  );
}
