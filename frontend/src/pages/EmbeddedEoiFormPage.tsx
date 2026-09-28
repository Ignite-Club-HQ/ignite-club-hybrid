import { useEffect, useState } from "react";

/**
 * Embedded EOI Form — iframe-optimized version
 * 
 * This is a lightweight wrapper around the public form that:
 * 1. Detects if it's running in an iframe
 * 2. Sends resize messages to parent window
 * 3. Handles postMessage communication for embeds
 * 
 * Usage: <iframe src="/eoi-embed/:clubSlug/:seasonSlug" />
 */

export default function EmbeddedEoiFormPage() {
  const [isIframe, setIsIframe] = useState(false);
  const [height, setHeight] = useState(800);

  useEffect(() => {
    // Detect if running in iframe
    const inIframe = window.self !== window.top;
    setIsIframe(inIframe);

    if (inIframe) {
      // Send resize messages to parent
      const sendHeight = () => {
        const contentHeight = document.documentElement.scrollHeight;
        window.parent.postMessage(
          { type: "ignite-eoi-resize", height: contentHeight },
          "*"
        );
      };

      // Initial height
      sendHeight();

      // Watch for content changes
      const observer = new ResizeObserver(sendHeight);
      observer.observe(document.body);

      // Periodic backup (for dynamic content)
      const interval = setInterval(sendHeight, 1000);

      return () => {
        observer.disconnect();
        clearInterval(interval);
      };
    }
  }, []);

  // Listen for messages from parent (if needed for future interactivity)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "ignite-eoi-theme") {
        // Future: apply theme overrides from parent
        console.log("[EOI Embed] Theme message received:", event.data);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Import and render the actual form
  const [PublicForm, setPublicForm] = useState<any>(null);

  useEffect(() => {
    import("./PublicEoiFormPage").then((mod) => {
      setPublicForm(() => mod.default);
    });
  }, []);

  if (!PublicForm) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div 
      className={isIframe ? "embedded-eoi-form" : ""}
      style={isIframe ? { minHeight: height } : undefined}
    >
      <PublicForm />
    </div>
  );
}
