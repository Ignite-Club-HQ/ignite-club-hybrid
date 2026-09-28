import { useState, useEffect } from "react";
import { Copy, Check, Code, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface EoiEmbedCardProps {
  clubId: string;
  seasonId: string;
  seasonSlug: string;
  clubSlug: string;
}

export function EoiEmbedCard({ clubId, seasonId, seasonSlug, clubSlug }: EoiEmbedCardProps) {
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    // Generate/fetch webhook token
    (async () => {
      const { data } = await supabase
        .from("seasons")
        .select("eoi_webhook_token")
        .eq("id", seasonId)
        .maybeSingle();
      
      if (data?.eoi_webhook_token) {
        setWebhookToken(data.eoi_webhook_token);
      } else {
        // Generate new token
        const newToken = crypto.randomUUID();
        await supabase
          .from("seasons")
          .update({ eoi_webhook_token: newToken })
          .eq("id", seasonId);
        setWebhookToken(newToken);
      }
    })();
  }, [seasonId]);

  const publicFormUrl = `https://reference.invalid`;

  const iframeCode = `<iframe 
  src="${publicFormUrl}" 
  width="100%" 
  height="800" 
  style="border: none; min-height: 600px;" 
  title="Expression of Interest"
  allow="clipboard-write"
></iframe>`;

  const jsEmbedCode = `<!-- Ignite EOI Form -->
<div id="ignite-eoi-form"></div>
<script>
  (function() {
    var iframe = document.createElement('iframe');
    iframe.src = '${publicFormUrl}';
    iframe.width = '100%';
    iframe.height = '800';
    iframe.style.border = 'none';
    iframe.style.minHeight = '600px';
    iframe.title = 'Expression of Interest';
    document.getElementById('ignite-eoi-form').appendChild(iframe);
  })();
</script>`;

  const webhookExample = `curl -X POST https://reference.invalid \\
  -H "Content-Type: application/json" \\
  -H "X-Webhook-Token: ${webhookToken || 'YOUR_TOKEN'}" \\
  -d '{
    "club_id": "${clubId}",
    "season_id": "${seasonId}",
    "parent_name": "Jane Smith",
    "parent_email": "redacted@example.invalid",
    "parent_mobile": "+61 400 000 000",
    "player_name": "Emma Smith",
    "player_dob": "2015-03-15",
    "player_gender": "Female",
    "preferred_teammates": "Friend from school",
    "skill_level": 3,
    "source": "club-website"
  }'`;

  const handleCopy = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code className="h-5 w-5" />
          Embed & API
        </CardTitle>
        <CardDescription>
          Add EOI forms to your club website or CRM
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Hosted URL */}
        <div className="space-y-2">
          <Label>Hosted Form URL</Label>
          <div className="flex gap-2">
            <Input value={publicFormUrl} readOnly className="font-mono text-sm" />
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleCopy(publicFormUrl, "url")}
            >
              {copied === "url" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => window.open(publicFormUrl, "_blank")}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Share this link directly or use the embed options below
          </p>
        </div>

        {/* Iframe Embed */}
        <div className="space-y-2">
          <Label>Iframe Embed Code</Label>
          <div className="relative">
            <pre className="bg-muted p-3 rounded-md text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {iframeCode}
            </pre>
            <Button
              variant="secondary"
              size="sm"
              className="absolute top-2 right-2"
              onClick={() => handleCopy(iframeCode, "iframe")}
            >
              {copied === "iframe" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Paste this into any page on your website
          </p>
        </div>

        {/* JavaScript Embed */}
        <div className="space-y-2">
          <Label>JavaScript Embed (Auto-resizing)</Label>
          <div className="relative">
            <pre className="bg-muted p-3 rounded-md text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {jsEmbedCode}
            </pre>
            <Button
              variant="secondary"
              size="sm"
              className="absolute top-2 right-2"
              onClick={() => handleCopy(jsEmbedCode, "js")}
            >
              {copied === "js" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Use this for better control over placement
          </p>
        </div>

        {/* Webhook API */}
        <div className="space-y-2 border-t pt-4">
          <Label className="flex items-center gap-2">
            Webhook API
            <span className="text-xs font-normal text-muted-foreground">(for CRM integration)</span>
          </Label>
          
          {webhookToken ? (
            <>
              <div className="relative">
                <pre className="bg-muted p-3 rounded-md text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                  {webhookExample}
                </pre>
                <Button
                  variant="secondary"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => handleCopy(webhookExample, "webhook")}
                >
                  {copied === "webhook" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                POST to this endpoint from your CRM or custom website. Keep your token secret.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Generating webhook token...</p>
          )}
        </div>

        {/* WordPress Shortcode (bonus) */}
        <div className="space-y-2 border-t pt-4">
          <Label>WordPress Shortcode</Label>
          <div className="relative">
            <pre className="bg-muted p-3 rounded-md text-xs font-mono">
              [iframe src="{publicFormUrl}" width="100%" height="800" frameborder="0"]
            </pre>
            <Button
              variant="secondary"
              size="sm"
              className="absolute top-2 right-2"
              onClick={() => handleCopy(`[iframe src="${publicFormUrl}" width="100%" height="800" frameborder="0"]`, "wp")}
            >
              {copied === "wp" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Requires the iframe plugin: [iframe src="{publicFormUrl}"]
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
