import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import { ROUTING_GATES_SNAPSHOT } from "@/live/generated/routingGates";
import { DEPLOYED_MAINNET_CANISTER_IDS } from "@/live/generated/deployedCanisterIds";
import { GROUP_TESTED_LIMITS } from "@/live/groupTestedLimits";
import { buildGroupSpecs } from "@/live/groupUtilization";

const WORKFLOW_URL = "https://github.com/Ignite-Club-HQ/ignite-club-hybrid/actions/workflows/migrate-club.yml";
const CLUB_ID = /^[0-9a-zA-Z][0-9a-zA-Z_-]{0,127}$/;

/**
 * Launch helper for moving one Supabase club into a canister group. Holds no
 * secrets and writes nothing: the move itself runs in the protected GitHub
 * workflow (check first, then migrate with the printed plan hash).
 */
export default function AdminClubMigrationPage() {
  const navigate = useNavigate();
  const { isAppAdmin, isLoading } = useIsAppAdmin();
  const groups = useMemo(() => buildGroupSpecs({
    snapshot: ROUTING_GATES_SNAPSHOT ?? null,
    sharedCanisterIds: DEPLOYED_MAINNET_CANISTER_IDS,
    testedLimits: GROUP_TESTED_LIMITS,
  }).groups, []);
  const [clubId, setClubId] = useState("");
  const [groupId, setGroupId] = useState("");

  if (isLoading) return null;
  if (!isAppAdmin) return <p className="p-6 text-sm text-muted-foreground">App admins only.</p>;

  const ready = CLUB_ID.test(clubId.trim()) && /^g\d+$/.test(groupId);
  const copy = (text: string) => { void navigator.clipboard.writeText(text); toast.success("Copied"); };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}><ArrowLeft className="mr-2 h-4 w-4" />Admin</Button>
      <Card>
        <CardHeader>
          <CardTitle>Migrate club to canisters</CardTitle>
          <CardDescription>Copying club data and moving member sign-ins require separate owner approvals for this club and group. Building this tool or running a check approves neither. The Supabase copy is never changed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="club-id">Club ID</Label>
            <Input id="club-id" value={clubId} onChange={(e) => setClubId(e.target.value)} placeholder="Supabase club ID" />
          </div>
          <div className="space-y-1.5">
            <Label>Target group</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger aria-label="Target group"><SelectValue placeholder="Choose a group" /></SelectTrigger>
              <SelectContent>
                {groups.filter((g) => /^g\d+$/.test(g.id)).map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.label}{g.accepting === false ? " (closed)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Open the workflow, choose <b>check</b>, and paste the club ID and group. It only reads and prints a plan hash.</li>
            <li>Only with your approval to copy data, choose approval scope <b>data</b> and <b>migrate</b>, the plan hash and <code>MIGRATE CLUB TO CANISTERS</code>. This does not authorize account links or changing sign-in.</li>
            <li>Resuming needs fresh data approval: choose <b>data</b> and <b>recover</b> with the same plan hash and <code>RECOVER CLUB MIGRATION</code>.</li>
            <li>Account links require a separate approval: choose <b>auth</b> and <b>invite</b>, with <code>SEND CLAIM EMAILS</code>. This does not authorize copying data. Sign-in cutover remains blocked until separately approved.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!ready} onClick={() => copy(clubId.trim())}><Copy className="mr-2 h-4 w-4" />Copy club ID</Button>
            <Button variant="outline" disabled={!ready} onClick={() => copy(groupId)}><Copy className="mr-2 h-4 w-4" />Copy group</Button>
            <Button disabled={!ready} onClick={() => window.open(WORKFLOW_URL, "_blank", "noopener")}><ExternalLink className="mr-2 h-4 w-4" />Open workflow</Button>
          </div>
          <p className="text-xs text-muted-foreground">Progress and the final report appear on the workflow run page.</p>
        </CardContent>
      </Card>
    </div>
  );
}
