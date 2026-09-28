import { Smartphone, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import igniteIcon from "@/assets/ignite-icon.png";

// Placeholder URLs - replace with actual store URLs once published
export const APP_STORE_URL = "https://reference.invalid";
export const PLAY_STORE_URL = "https://reference.invalid";

interface AppStoreDownloadGuideProps {
  onContinueInBrowser?: () => void;
  compact?: boolean;
}

function detectPlatform(): "ios" | "android" | "unknown" {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "unknown";
}

export function AppStoreDownloadGuide({ onContinueInBrowser, compact = false }: AppStoreDownloadGuideProps) {
  const platform = detectPlatform();

  if (compact) {
    return (
      <div className="space-y-3 bg-muted/50 rounded-lg p-4">
        <div className="flex items-center gap-3 justify-center">
          <img src={igniteIcon} alt="Ignite Club HQ" className="h-10 w-10 rounded-xl" />
          <div>
            <p className="font-medium text-sm">Download Ignite Club HQ</p>
            <p className="text-xs text-muted-foreground">Get the best experience with our app</p>
          </div>
        </div>
        <div className="flex gap-2 justify-center">
          {(platform === "ios" || platform === "unknown") && (
            <Button size="sm" asChild>
              <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
                App Store <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          )}
          {(platform === "android" || platform === "unknown") && (
            <Button size="sm" variant={platform === "android" ? "default" : "outline"} asChild>
              <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
                Google Play <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          )}
        </div>
        {onContinueInBrowser && (
          <button 
            onClick={onContinueInBrowser}
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Continue in browser instead
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center space-y-6">
            {/* App icon */}
            <div className="flex justify-center">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                <img 
                  src={igniteIcon} 
                  alt="Ignite Club HQ"
                  className="h-16 w-16 rounded-xl"
                />
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold">Download Ignite Club HQ</h2>
              <p className="text-muted-foreground">
                Get the full experience with our native app
              </p>
            </div>

            {/* Store buttons */}
            <div className="space-y-3">
              {(platform === "ios" || platform === "unknown") && (
                <Button className="w-full h-12 text-base" asChild>
                  <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
                    <Smartphone className="h-5 w-5 mr-2" />
                    Download on the App Store
                  </a>
                </Button>
              )}
              {(platform === "android" || platform === "unknown") && (
                <Button 
                  className="w-full h-12 text-base" 
                  variant={platform === "android" ? "default" : "outline"}
                  asChild
                >
                  <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
                    <Smartphone className="h-5 w-5 mr-2" />
                    Get it on Google Play
                  </a>
                </Button>
              )}
            </div>

            {/* Benefits */}
            <div className="flex justify-center gap-6 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="text-base">⚡</span>
                <span>Faster</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-base">🔔</span>
                <span>Notifications</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-base">📱</span>
                <span>Full screen</span>
              </div>
            </div>

            {onContinueInBrowser && (
              <button 
                onClick={onContinueInBrowser}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Continue in browser instead
              </button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
