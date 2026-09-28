import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";

interface LegalPageEmbedProps {
  title: string;
  websiteUrl: string;
}

export default function LegalPageEmbed({ title, websiteUrl }: LegalPageEmbedProps) {
  const navigate = useNavigate();
  const isNative = Capacitor.isNativePlatform();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // On web, redirect to the website directly
    if (!isNative) {
      window.location.href = websiteUrl;
    }
  }, [isNative, websiteUrl]);

  // On web, show nothing while redirecting
  if (!isNative) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div
        className="sticky top-0 z-10 bg-background border-b border-border px-4 pb-4 flex items-center gap-3"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 24px)" }}
      >
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold">{title}</h1>
      </div>

      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <iframe
          src={websiteUrl}
          className="w-full h-full border-0"
          style={{ minHeight: "calc(100vh - 64px)" }}
          onLoad={() => setIsLoading(false)}
          title={title}
        />
      </div>
    </div>
  );
}
