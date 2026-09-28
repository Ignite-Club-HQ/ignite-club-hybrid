import { Flame } from "lucide-react";

interface ChatEmptyStateProps {
  title: string;
  subtitle?: string;
  isSearchResult?: boolean;
}

export function ChatEmptyState({ title, subtitle, isSearchResult = false }: ChatEmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12">
      <div className="p-4 rounded-2xl bg-primary/10">
        <Flame className="h-10 w-10 text-primary" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-muted-foreground font-medium">
          {isSearchResult ? "No messages found" : title}
        </p>
        {subtitle && !isSearchResult && (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
