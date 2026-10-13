import { Loader2 } from "lucide-react";

/** Shared startup/sign-in splash: Ignite icon, wordmark and loading label. */
export function AppSplash({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background">
      <img src="/icon-512.png" alt="Ignite logo" className="h-24 w-24 rounded-3xl shadow-md" />
      <div className="text-center text-2xl font-bold tracking-tight text-foreground">Ignite Club HQ</div>
      <div className="flex items-center gap-2" role="status">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
