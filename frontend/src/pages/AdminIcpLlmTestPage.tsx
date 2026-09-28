import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Sparkles, MessageSquare } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const MODELS = [
  { value: "llama3.1:8b", label: "Llama 3.1 8B" },
  { value: "llama4-scout", label: "Llama 4 Scout" },
  { value: "qwen3:32b", label: "Qwen 3 32B" },
];

const SUMMARY_SYSTEM = `You are a helpful club secretary. Summarise the following team chat messages in a friendly, concise way. Group updates by topic (e.g. "Match Day", "Training", "Logistics") and highlight any action items or questions that still need a response.`;

const EXAMPLES = [
  {
    label: "Match day logistics",
    system: SUMMARY_SYSTEM,
    prompt: `Coach Dave: "Reminder — under-12s match this Saturday 10:30 at Oaklands Reserve. Please confirm availability by Thursday night."
Sarah (parent): "Can we get a lift for Jake? Happy to help with car pool."
Mike: "Jake and I can take 3 kids from the club rooms at 9:45."
Coach Dave: "Great, thanks Mike. I'll add you to the duty roster."
Jenny: "Is the canteen open? Need to know if kids need water bottles."
Coach Dave: "Canteen confirmed open. Water bottles still recommended — it's going to be 28°C."
Tom: "What colour socks this week?"
Coach Dave: "Home kit — red socks, black shorts."
Sarah: "Jake is confirmed going."`,
  },
  {
    label: "Training & weather cancellation",
    system: SUMMARY_SYSTEM,
    prompt: `Coach Lisa: "Tuesday training is ON despite the rain. We have indoor courts booked from 6:00pm."
Mark: "Do we still need shin guards indoors?"
Coach Lisa: "Yes, shin guards mandatory for all indoor sessions too."
Emma: "My daughter can't make it — she's got a school concert."
Coach Lisa: "No worries Emma, noted."
James: "Will there be a fitness circuit or just drills?"
Coach Lisa: "Mixed session — 20 mins fitness, 40 mins small-sided games."
Anna: "Is there parking near the indoor entrance?"
Coach Lisa: "Use the rear car park, door code is 4821."`,
  },
  {
    label: "Team fundraiser & parent jobs",
    system: SUMMARY_SYSTEM,
    prompt: `Committee: "BBQ fundraiser this Sunday — we need 2 parents to run the grill and 1 to handle cash."
Paul: "I can do the grill from 11–1."
Committee: "Thanks Paul! Need one more for 1–3 shift."
Rachel: "I'll handle cash for the whole day. Do I need a float?"
Committee: "Yes, we'll give you $100 float at 10:30. Please arrive by 10:15 for setup."
Dave: "What should we bring?"
Committee: "Aprons and tongs provided. Just wear club polo if you have one."
Sarah: "Can kids help or is it adults only?"
Committee: "Kids 12+ welcome with parent supervision."`,
  },
  {
    label: "Away trip planning",
    system: SUMMARY_SYSTEM,
    prompt: `Manager Rob: "Under-14s away game at Hillside next Sunday. Bus leaves club at 8:00am sharp."
Karen: "What's the return time roughly?"
Manager Rob: "Match finishes around 12:30, back by 1:30."
Steve: "My son needs a gluten-free lunch option."
Manager Rob: "Noted — I'll tell the canteen manager at Hillside."
Jess: "Is there a team sheet yet?"
Manager Rob: "Still waiting on 2 medical forms. Will share once confirmed."
Luke: "Can I drive instead of taking the bus?"
Manager Rob: "Yes, but you must still register arrival at 8:45 for the duty of care check."`,
  },
  {
    label: "Mixed chatter + action items",
    system: SUMMARY_SYSTEM,
    prompt: `Coach Ben: "Great win on the weekend! Final score 4–2. Player of the match was Olivia."
Olivia's mum: "So proud! Thanks coaches."
Coach Ben: "Training this Wednesday moved to 5:30pm due to grounds being closed earlier."
Dave: "Will it finish at the same time?"
Coach Ben: "Yes, 6:30pm finish."
Sue: "Has anyone seen a blue drink bottle left behind?"
Coach Ben: "Sue — check the kit bag, I think I saw one."
Sue: "Got it, thanks!"
Coach Ben: "Reminder: fees are due by end of month. Please pay via the app or at the desk."
Terry: "Is there a payment plan option?"
Coach Ben: "Yes Terry — DM me and I'll connect you with the treasurer."`,
  },
];

import { IcpUnavailablePage } from "@/components/IcpUnavailablePage";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

export default function AdminIcpLlmTestPage() {
  if (resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true)) {
    return <IcpUnavailablePage title="LLM testing is unavailable in ICP lab mode" description="LLM credentials and inference remain outside ordinary canister and frontend state." />;
  }
  return <SupabaseAdminIcpLlmTestPage />;
}

function SupabaseAdminIcpLlmTestPage() {
  const navigate = useNavigate();
  const [model, setModel] = useState("llama3.1:8b");
  const [system, setSystem] = useState("You are a concise assistant.");
  const [prompt, setPrompt] = useState("In one sentence, what is the Internet Computer?");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ response: string; elapsedMs: number } | null>(null);
  const [activeExample, setActiveExample] = useState<string | null>(null);

  const applyExample = (ex: (typeof EXAMPLES)[0]) => {
    setSystem(ex.system);
    setPrompt(ex.prompt);
    setActiveExample(ex.label);
    setResult(null);
  };

  const run = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("icp-llm-test", {
        body: { prompt, system: system || undefined, model },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).detail || (data as any).error);
      setResult({ response: (data as any).response, elapsedMs: (data as any).elapsedMs });
    } catch (e: any) {
      toast.error(e?.message ?? "ICP LLM call failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pt-safe">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm">
        <div className="container flex h-14 items-center gap-2 px-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">ICP LLM Test</h1>
        </div>
      </header>

      <main className="container max-w-2xl space-y-4 px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" />
              DFINITY hosted LLM canister
            </CardTitle>
            <CardDescription>
              Calls canister <code className="text-xs">w36hm-eqaaa-aaaal-qr76a-cai</code> on
              mainnet via anonymous identity. No cycles, no auth.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>System prompt</Label>
              <Input value={system} onChange={(e) => setSystem(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Prompt</Label>
              <Textarea
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ask the ICP LLM something…"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Example team-message prompts</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <Badge
                    key={ex.label}
                    variant={activeExample === ex.label ? "default" : "secondary"}
                    className="cursor-pointer select-none"
                    onClick={() => applyExample(ex)}
                  >
                    {ex.label}
                  </Badge>
                ))}
              </div>
            </div>

            <Button onClick={run} disabled={loading || !prompt.trim()} className="w-full">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {loading ? "Calling canister…" : "Run"}
            </Button>
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Response</CardTitle>
              <CardDescription>Round-trip: {result.elapsedMs} ms</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">{result.response}</pre>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
