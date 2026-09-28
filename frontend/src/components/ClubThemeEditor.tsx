import { useState } from "react";
import { Palette, RotateCcw, Loader2, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "next-themes";

interface HSLColor {
  h: number;
  s: number;
  l: number;
}

interface ClubThemeEditorProps {
  clubId: string;
  clubLogoUrl?: string | null;
  initialPrimary?: HSLColor | null;
  initialSecondary?: HSLColor | null;
  initialAccent?: HSLColor | null;
  initialDarkPrimary?: HSLColor | null;
  initialDarkSecondary?: HSLColor | null;
  initialDarkAccent?: HSLColor | null;
  initialShowLogoInHeader?: boolean;
  initialShowNameInHeader?: boolean;
  initialLogoOnlyMode?: boolean;
  initialThemeEnabled?: boolean;
  onSave?: () => void;
}

const DEFAULT_LIGHT_COLORS = {
  primary: { h: 160, s: 84, l: 45 },
  secondary: { h: 160, s: 20, l: 90 },
  accent: { h: 160, s: 40, l: 85 },
};

const DEFAULT_DARK_COLORS = {
  primary: { h: 160, s: 84, l: 45 },
  secondary: { h: 160, s: 20, l: 18 },
  accent: { h: 160, s: 40, l: 20 },
};

// Color conversion utilities
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s = s / 100;
  l = l / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;

  if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
  else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
  else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
  else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
  else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function rgbToHsl(r: number, g: number, b: number): HSLColor {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function hslToHex(h: number, s: number, l: number): string {
  const rgb = hslToRgb(h, s, l);
  return `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`.toUpperCase();
}

function hexToHsl(hex: string): HSLColor | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  return rgbToHsl(
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16)
  );
}

function ColorPreview({ color, label }: { color: HSLColor; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div 
        className="h-8 w-8 rounded-md border border-border shadow-sm"
        style={{ backgroundColor: `hsl(${color.h}, ${color.s}%, ${color.l}%)` }}
      />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

function ColorSliders({ 
  color, 
  onChange,
  label,
}: { 
  color: HSLColor; 
  onChange: (color: HSLColor) => void;
  label: string;
}) {
  const rgb = hslToRgb(color.h, color.s, color.l);
  const hex = hslToHex(color.h, color.s, color.l);

  const handleHexChange = (value: string) => {
    const hsl = hexToHsl(value);
    if (hsl) onChange(hsl);
  };

  const handleRgbChange = (channel: 'r' | 'g' | 'b', value: string) => {
    const num = parseInt(value) || 0;
    const clamped = Math.max(0, Math.min(255, num));
    const newRgb = { ...rgb, [channel]: clamped };
    onChange(rgbToHsl(newRgb.r, newRgb.g, newRgb.b));
  };

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between p-2 h-auto">
          <ColorPreview color={color} label={label} />
          <Badge variant="outline" className="text-xs">
            {hex}
          </Badge>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 pb-2 px-2">
        {/* Hex and RGB inputs */}
        <div className="grid grid-cols-4 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Hex</Label>
            <Input
              value={hex}
              onChange={(e) => handleHexChange(e.target.value)}
              placeholder="#000000"
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">R</Label>
            <Input
              type="number"
              min={0}
              max={255}
              value={rgb.r}
              onChange={(e) => handleRgbChange('r', e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">G</Label>
            <Input
              type="number"
              min={0}
              max={255}
              value={rgb.g}
              onChange={(e) => handleRgbChange('g', e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">B</Label>
            <Input
              type="number"
              min={0}
              max={255}
              value={rgb.b}
              onChange={(e) => handleRgbChange('b', e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ClubThemeEditor({
  clubId,
  clubLogoUrl,
  initialPrimary,
  initialSecondary,
  initialAccent,
  initialDarkPrimary,
  initialDarkSecondary,
  initialDarkAccent,
  initialShowLogoInHeader = false,
  initialShowNameInHeader = true,
  initialLogoOnlyMode = false,
  initialThemeEnabled = true,
  onSave,
}: ClubThemeEditorProps) {
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const [saving, setSaving] = useState(false);
  
  // Light mode colors
  const [primary, setPrimary] = useState<HSLColor>(
    initialPrimary || DEFAULT_LIGHT_COLORS.primary
  );
  const [secondary, setSecondary] = useState<HSLColor>(
    initialSecondary || DEFAULT_LIGHT_COLORS.secondary
  );
  const [accent, setAccent] = useState<HSLColor>(
    initialAccent || DEFAULT_LIGHT_COLORS.accent
  );
  
  // Dark mode colors
  const [darkPrimary, setDarkPrimary] = useState<HSLColor>(
    initialDarkPrimary || DEFAULT_DARK_COLORS.primary
  );
  const [darkSecondary, setDarkSecondary] = useState<HSLColor>(
    initialDarkSecondary || DEFAULT_DARK_COLORS.secondary
  );
  const [darkAccent, setDarkAccent] = useState<HSLColor>(
    initialDarkAccent || DEFAULT_DARK_COLORS.accent
  );
  
  const [showLogoInHeader, setShowLogoInHeader] = useState(initialShowLogoInHeader);
  const [showNameInHeader, setShowNameInHeader] = useState(initialShowNameInHeader);
  const [logoOnlyMode, setLogoOnlyMode] = useState(initialLogoOnlyMode);
  const [themeEnabled, setThemeEnabled] = useState(initialThemeEnabled);

  // Determine which tab to show based on current system theme
  const [activeTab, setActiveTab] = useState<string>(resolvedTheme === "dark" ? "dark" : "light");

  const handleSave = async () => {
    setSaving(true);
    
    const { error } = await supabase
      .from("clubs")
      .update({
        theme_primary_h: primary.h,
        theme_primary_s: primary.s,
        theme_primary_l: primary.l,
        theme_secondary_h: secondary.h,
        theme_secondary_s: secondary.s,
        theme_secondary_l: secondary.l,
        theme_accent_h: accent.h,
        theme_accent_s: accent.s,
        theme_accent_l: accent.l,
        theme_dark_primary_h: darkPrimary.h,
        theme_dark_primary_s: darkPrimary.s,
        theme_dark_primary_l: darkPrimary.l,
        theme_dark_secondary_h: darkSecondary.h,
        theme_dark_secondary_s: darkSecondary.s,
        theme_dark_secondary_l: darkSecondary.l,
        theme_dark_accent_h: darkAccent.h,
        theme_dark_accent_s: darkAccent.s,
        theme_dark_accent_l: darkAccent.l,
        show_logo_in_header: showLogoInHeader,
        show_name_in_header: showNameInHeader,
        logo_only_mode: logoOnlyMode,
      })
      .eq("id", clubId);

    setSaving(false);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to save theme. Please try again.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Theme saved!",
      description: "Your club's color scheme has been updated.",
    });
    
    onSave?.();
  };

  const handleResetLight = () => {
    setPrimary(DEFAULT_LIGHT_COLORS.primary);
    setSecondary(DEFAULT_LIGHT_COLORS.secondary);
    setAccent(DEFAULT_LIGHT_COLORS.accent);
  };

  const handleResetDark = () => {
    setDarkPrimary(DEFAULT_DARK_COLORS.primary);
    setDarkSecondary(DEFAULT_DARK_COLORS.secondary);
    setDarkAccent(DEFAULT_DARK_COLORS.accent);
  };


  const handleClear = async () => {
    setSaving(true);
    
    const { error } = await supabase
      .from("clubs")
      .update({
        theme_primary_h: null,
        theme_primary_s: null,
        theme_primary_l: null,
        theme_secondary_h: null,
        theme_secondary_s: null,
        theme_secondary_l: null,
        theme_accent_h: null,
        theme_accent_s: null,
        theme_accent_l: null,
        theme_dark_primary_h: null,
        theme_dark_primary_s: null,
        theme_dark_primary_l: null,
        theme_dark_secondary_h: null,
        theme_dark_secondary_s: null,
        theme_dark_secondary_l: null,
      })
      .eq("id", clubId);

    setSaving(false);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to clear theme. Please try again.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Theme cleared",
      description: "Your club's custom theme has been removed.",
    });
    
    onSave?.();
  };

  // Get preview colors based on active tab
  const previewColors = activeTab === "dark" 
    ? { primary: darkPrimary, secondary: darkSecondary, accent: darkAccent }
    : { primary, secondary, accent };
  
  const previewBg = activeTab === "dark" ? "hsl(160, 15%, 6%)" : "hsl(0, 0%, 98%)";
  const previewText = activeTab === "dark" ? "#fafafa" : "#1a1a1a";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Club Theme</CardTitle>
          <Badge variant="secondary" className="ml-auto">Pro</Badge>
        </div>
        <CardDescription>
          Customize your club's colors for light and dark mode separately. Members can apply this theme via the palette icon in the header.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Master theme toggle */}
        <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
          <div className="space-y-0.5">
            <Label htmlFor="theme-enabled" className="text-sm font-medium">Enable Club Theme</Label>
            <p className="text-xs text-muted-foreground">
              Allow members to apply your club's colours via the theme selector
            </p>
          </div>
          <Switch
            id="theme-enabled"
            checked={themeEnabled}
            onCheckedChange={async (checked) => {
              setThemeEnabled(checked);
              
              const { error } = await supabase
                .from("clubs")
                .update({ theme_enabled: checked })
                .eq("id", clubId);
              
              if (error) {
                toast({
                  title: "Error",
                  description: "Failed to update theme setting.",
                  variant: "destructive",
                });
                setThemeEnabled(!checked);
                return;
              }
              
              toast({
                title: checked ? "Theme enabled" : "Theme disabled",
                description: checked 
                  ? "Members can now apply your club's theme." 
                  : "Your club theme is now hidden from members.",
              });
              onSave?.();
            }}
          />
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="light" className="flex items-center gap-2">
              <Sun className="h-4 w-4" />
              Light Mode
            </TabsTrigger>
            <TabsTrigger value="dark" className="flex items-center gap-2">
              <Moon className="h-4 w-4" />
              Dark Mode
            </TabsTrigger>
          </TabsList>

          {/* Preview - updates based on active tab */}
          <div 
            className="rounded-lg p-4 space-y-3 mt-4"
            style={{ backgroundColor: previewBg }}
          >
            <p className="text-xs" style={{ color: activeTab === "dark" ? "#a1a1aa" : "#71717a" }}>
              Preview ({activeTab} mode)
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                style={{
                  backgroundColor: `hsl(${previewColors.primary.h}, ${previewColors.primary.s}%, ${previewColors.primary.l}%)`,
                  color: previewColors.primary.l > 50 ? '#1a1a1a' : '#fafafa',
                }}
              >
                Primary Button
              </Button>
              <Button
                size="sm"
                variant="secondary"
                style={{
                  backgroundColor: `hsl(${previewColors.secondary.h}, ${previewColors.secondary.s}%, ${previewColors.secondary.l}%)`,
                  color: previewColors.secondary.l > 50 ? '#1a1a1a' : '#fafafa',
                }}
              >
                Secondary
              </Button>
            </div>
            <div 
              className="rounded-md p-3"
              style={{
                backgroundColor: `hsl(${previewColors.accent.h}, ${previewColors.accent.s}%, ${previewColors.accent.l}%)`,
              }}
            >
              <p 
                className="text-sm"
                style={{ color: previewColors.accent.l > 50 ? '#1a1a1a' : '#fafafa' }}
              >
                Accent card content
              </p>
            </div>
          </div>

          <TabsContent value="light" className="mt-4 space-y-4">
            {/* Light mode color editors */}
            <div className="space-y-2 border rounded-lg">
              <ColorSliders color={primary} onChange={setPrimary} label="Primary" />
              <ColorSliders color={secondary} onChange={setSecondary} label="Secondary" />
              <ColorSliders color={accent} onChange={setAccent} label="Accent" />
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleResetLight}
              disabled={saving}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset Light Colors
            </Button>
          </TabsContent>

          <TabsContent value="dark" className="mt-4 space-y-4">
            {/* Dark mode color editors */}
            <div className="space-y-2 border rounded-lg">
              <ColorSliders color={darkPrimary} onChange={setDarkPrimary} label="Primary" />
              <ColorSliders color={darkSecondary} onChange={setDarkSecondary} label="Secondary" />
              <ColorSliders color={darkAccent} onChange={setDarkAccent} label="Accent" />
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleResetDark}
              disabled={saving}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset Dark Colors
            </Button>
          </TabsContent>
        </Tabs>

        {/* Logo only mode toggle */}
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-0.5">
            <Label htmlFor="logo-only" className="text-sm font-medium">Logo Only Mode</Label>
            <p className="text-xs text-muted-foreground">
              {clubLogoUrl 
                ? "Show club logo in header without changing app theme colours"
                : "Upload a club logo first to enable this feature"}
            </p>
          </div>
          <Switch
            id="logo-only"
            checked={logoOnlyMode}
            onCheckedChange={async (checked) => {
              setLogoOnlyMode(checked);
              if (checked) {
                setShowLogoInHeader(true);
              }
              
              // Auto-save logo only mode immediately
              const { error } = await supabase
                .from("clubs")
                .update({
                  logo_only_mode: checked,
                  show_logo_in_header: checked ? true : showLogoInHeader,
                })
                .eq("id", clubId);
              
              if (error) {
                toast({
                  title: "Error",
                  description: "Failed to update setting.",
                  variant: "destructive",
                });
                setLogoOnlyMode(!checked);
                return;
              }
              
              toast({
                title: checked ? "Logo Only Mode enabled" : "Logo Only Mode disabled",
                description: checked 
                  ? "Theme colours will use app defaults"
                  : "Custom theme colours will be applied",
              });
              
              onSave?.();
            }}
            disabled={!clubLogoUrl}
          />
        </div>

        {/* Logo in header toggle - disabled when logo only mode is on */}
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-0.5">
            <Label htmlFor="show-logo" className="text-sm font-medium">Show Club Logo in Header</Label>
            <p className="text-xs text-muted-foreground">
              {clubLogoUrl 
                ? "Display your club logo in the app header when this theme is active"
                : "Upload a club logo first to enable this feature"}
            </p>
          </div>
          <Switch
            id="show-logo"
            checked={showLogoInHeader}
            onCheckedChange={async (checked) => {
              setShowLogoInHeader(checked);
              
              // Auto-save immediately
              const { error } = await supabase
                .from("clubs")
                .update({ show_logo_in_header: checked })
                .eq("id", clubId);
              
              if (error) {
                toast({
                  title: "Error",
                  description: "Failed to update setting.",
                  variant: "destructive",
                });
                setShowLogoInHeader(!checked);
                return;
              }
              
              toast({
                title: checked ? "Club logo enabled" : "Club logo disabled",
                description: checked 
                  ? "Club logo will show in header"
                  : "Club logo hidden from header",
              });
              
              onSave?.();
            }}
            disabled={!clubLogoUrl || logoOnlyMode}
          />
        </div>

        {/* Name in header toggle */}
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-0.5">
            <Label htmlFor="show-name" className="text-sm font-medium">Show Club Name in Header</Label>
            <p className="text-xs text-muted-foreground">
              Display your club name text in the app header when this theme is active
            </p>
          </div>
          <Switch
            id="show-name"
            checked={showNameInHeader}
            onCheckedChange={async (checked) => {
              setShowNameInHeader(checked);
              
              // Auto-save immediately
              const { error } = await supabase
                .from("clubs")
                .update({ show_name_in_header: checked })
                .eq("id", clubId);
              
              if (error) {
                toast({
                  title: "Error",
                  description: "Failed to update setting.",
                  variant: "destructive",
                });
                setShowNameInHeader(!checked);
                return;
              }
              
              toast({
                title: checked ? "Club name enabled" : "Club name disabled",
                description: checked 
                  ? "Club name will show in header"
                  : "Club name hidden from header",
              });
              
              onSave?.();
            }}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {initialPrimary && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleClear}
              disabled={saving}
              className="text-destructive hover:text-destructive"
            >
              Clear Theme
            </Button>
          )}
          <Button 
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="ml-auto"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Save Theme
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
