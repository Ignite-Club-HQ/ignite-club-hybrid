import { Pencil, X } from "lucide-react";

interface EditingBannerProps {
  text: string;
  onCancel: () => void;
}

export function EditingBanner({ text, onCancel }: EditingBannerProps) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/50 rounded-lg border-l-2 border-primary mb-1">
      <Pencil className="h-3.5 w-3.5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-primary">Editing message</p>
        <p className="text-xs text-muted-foreground truncate">{text.replace(/@\[([^\]]+)\]\([^)]+\)/g, '$1')}</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 p-1 rounded-full hover:bg-accent transition-colors"
      >
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  );
}
