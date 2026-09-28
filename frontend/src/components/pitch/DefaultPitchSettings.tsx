import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { TeamSize } from "./types";

const FORMATIONS: Record<TeamSize, { name: string }[]> = {
  "3": [
    { name: "1-1-1" },
    { name: "2-1" },
    { name: "1-2" },
  ],
  "4": [
    { name: "1-2-1" },
    { name: "2-1-1" },
    { name: "1-1-2" },
  ],
  "5": [
    { name: "1-2-1-1" },
    { name: "2-1-2" },
    { name: "1-3-1" },
    { name: "2-2-1" },
  ],
  "6": [
    { name: "2-2-1" },
    { name: "1-3-1" },
    { name: "2-1-2" },
  ],
  "7": [
    { name: "2-3-1" },
    { name: "3-2-1" },
    { name: "2-2-2" },
  ],
  "8": [
    { name: "3-3-1" },
    { name: "2-3-2" },
    { name: "3-2-2" },
  ],
  "9": [
    { name: "3-3-2" },
    { name: "3-2-3" },
    { name: "2-4-2" },
  ],
  "10": [
    { name: "3-4-2" },
    { name: "4-3-2" },
    { name: "3-3-3" },
  ],
  "11": [
    { name: "4-4-2" },
    { name: "4-3-3" },
    { name: "3-5-2" },
    { name: "4-2-3-1" },
  ],
};

const TEAM_SIZES: TeamSize[] = ["3", "4", "5", "6", "7", "8", "9", "10", "11"];
const MINUTES_OPTIONS = [5, 7, 10, 12, 15, 20, 25, 30, 35, 40, 45];
const ROTATION_SPEEDS = [
  { value: "1", label: "Standard", desc: "Fewer subs, simple FIFO rotation, fair for everyone" },
  { value: "2", label: "Frequent", desc: "2 subs per window — tighter time balance" },
];

interface DefaultPitchSettingsProps {
  teamSize: number;
  formation: string | null;
  minutesPerHalf: number;
  rotationSpeed: number;
  disableAutoSubs: boolean;
  disablePositionSwaps: boolean;
  isSaving?: boolean;
  onTeamSizeChange: (size: number) => void;
  onFormationChange: (formation: string, newTeamSize?: number) => void;
  onMinutesPerHalfChange: (minutes: number) => void;
  onRotationSpeedChange: (speed: number) => void;
  onDisableAutoSubsChange: (disabled: boolean) => void;
  onDisablePositionSwapsChange: (disabled: boolean) => void;
}

export function DefaultPitchSettings({
  teamSize,
  formation,
  minutesPerHalf,
  rotationSpeed,
  disableAutoSubs,
  disablePositionSwaps,
  isSaving = false,
  onTeamSizeChange,
  onFormationChange,
  onMinutesPerHalfChange,
  onRotationSpeedChange,
  onDisableAutoSubsChange,
  onDisablePositionSwapsChange,
}: DefaultPitchSettingsProps) {
  const currentSize = (teamSize?.toString() || "7") as TeamSize;
  const availableFormations = FORMATIONS[currentSize] || FORMATIONS["7"];
  
  // Default to first formation if current formation is not valid for size
  const currentFormation = formation && availableFormations.some(f => f.name === formation) 
    ? formation 
    : availableFormations[0]?.name;

  const handleTeamSizeChange = (value: string) => {
    const newSize = parseInt(value);
    const newSizeKey = value as TeamSize;
    onTeamSizeChange(newSize);
    // Reset to first formation for new size and pass both size and formation
    const newFormations = FORMATIONS[newSizeKey];
    if (newFormations?.[0]) {
      onFormationChange(newFormations[0].name, newSize);
    }
  };

  return (
    <Card className="relative">
      {isSaving && (
        <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10 rounded-lg">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
      <CardHeader>
        <CardTitle className="text-lg">Default Pitch Settings</CardTitle>
        <CardDescription>
          Configure the default settings for the pitch board
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Team Size</Label>
            <Select value={currentSize} onValueChange={handleTeamSizeChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select team size" />
              </SelectTrigger>
              <SelectContent>
                {TEAM_SIZES.map((size) => (
                  <SelectItem key={size} value={size}>
                    {size} players
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Default Formation</Label>
            <Select value={currentFormation} onValueChange={onFormationChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select formation" />
              </SelectTrigger>
              <SelectContent>
                {availableFormations.map((f) => (
                  <SelectItem key={f.name} value={f.name}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Minutes Per Half</Label>
            <Select 
              value={minutesPerHalf.toString()} 
              onValueChange={(v) => onMinutesPerHalfChange(parseInt(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select minutes" />
              </SelectTrigger>
              <SelectContent>
                {MINUTES_OPTIONS.map((mins) => (
                  <SelectItem key={mins} value={mins.toString()}>
                    {mins} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Rotation Speed</Label>
            <Select 
              value={(rotationSpeed >= 2 ? 2 : 1).toString()} 
              onValueChange={(v) => onRotationSpeedChange(parseInt(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select speed" />
              </SelectTrigger>
              <SelectContent>
                {ROTATION_SPEEDS.map((speed) => (
                  <SelectItem key={speed.value} value={speed.value}>
                    <div>
                      <span>{speed.label}</span>
                      <p className="text-xs text-muted-foreground">{speed.desc}</p>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable Auto Substitutions</p>
              <p className="text-xs text-muted-foreground">Automatically suggest subs during game</p>
            </div>
            <Switch
              checked={!disableAutoSubs}
              onCheckedChange={(checked) => onDisableAutoSubsChange(!checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable Position Swaps</p>
              <p className="text-xs text-muted-foreground">Allow swapping player positions on pitch</p>
            </div>
            <Switch
              checked={!disablePositionSwaps}
              onCheckedChange={(checked) => onDisablePositionSwapsChange(!checked)}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
