import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { isIcpSession } from "@/lib/icpClubTeamLookup";

/** App-admin tool: create a synthetic club with teams, events, chats and photos (ICP mode). */
export function SeedTestDataCard() {
  const qc = useQueryClient();
  const [clubName, setClubName] = useState("Test Club");
  const [perTeam, setPerTeam] = useState(300);
  const [clubMsgs, setClubMsgs] = useState(100);
  const [photos, setPhotos] = useState(12);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);

  if (!isIcpSession()) return null;

  const run = async () => {
    setRunning(true);
    try {
      const { seedIcpTestData } = await import("@/live/seedIcpTestData");
      await seedIcpTestData({
        clubName: clubName.trim() || "Test Club",
        messagesPerTeamChat: Math.min(Math.max(perTeam, 0), 2000),
        clubChatMessages: Math.min(Math.max(clubMsgs, 0), 2000),
        photos: Math.min(Math.max(photos, 0), 50),
        onProgress: (label, done, total) => setProgress({ label, done, total }),
      });
      qc.invalidateQueries();
      toast.success("Test club created — check Home, Messages, Schedule and Media");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create test data");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test data</CardTitle>
        <CardDescription>
          Creates a new club with 3 teams, a month of events, long chat histories and sample photos, all under your account. Keep this page open while it runs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label htmlFor="seed-club">Club name</Label>
            <Input id="seed-club" value={clubName} onChange={(e) => setClubName(e.target.value)} disabled={running} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="seed-team">Messages per team chat</Label>
            <Input id="seed-team" type="number" value={perTeam} onChange={(e) => setPerTeam(+e.target.value)} disabled={running} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="seed-club-msgs">Club chat messages</Label>
            <Input id="seed-club-msgs" type="number" value={clubMsgs} onChange={(e) => setClubMsgs(+e.target.value)} disabled={running} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="seed-photos">Photos</Label>
            <Input id="seed-photos" type="number" value={photos} onChange={(e) => setPhotos(+e.target.value)} disabled={running} />
          </div>
        </div>
        {progress && (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{progress.label} {progress.total > 1 ? `(${progress.done}/${progress.total})` : ""}</p>
            <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} />
          </div>
        )}
        <Button onClick={run} disabled={running}>
          {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create test club
        </Button>
      </CardContent>
    </Card>
  );
}
