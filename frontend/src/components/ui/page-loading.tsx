import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import igniteIcon from "@/assets/ignite-icon.png";

interface PageLoadingProps {
  message?: string;
}

export function PageLoading({ message = "Loading app..." }: PageLoadingProps) {
  const [mounted, setMounted] = useState(false);
  const [showLoader, setShowLoader] = useState(false);

  useEffect(() => {
    setMounted(true);
    const timer = setTimeout(() => setShowLoader(true), 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`flex-1 flex flex-col items-center justify-center py-12 bg-background transition-opacity duration-300 ${showLoader ? 'opacity-100' : 'opacity-0'}`}>
      <div className={`flex flex-col items-center gap-4 transition-opacity duration-300 ${
        mounted ? "opacity-100" : "opacity-0"
      }`}>
        <img
          src={igniteIcon}
          alt="Ignite"
          className="h-16 w-16 rounded-2xl object-cover shadow-md"
        />
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <p className="text-sm font-medium text-muted-foreground">{message}</p>
        </div>
      </div>
    </div>
  );
}
