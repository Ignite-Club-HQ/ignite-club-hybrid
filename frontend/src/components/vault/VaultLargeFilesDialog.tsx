import { FileImage, FileText, HardDrive, Loader2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import type { VaultLargeFileItem, VaultLargeFileSort } from "@/features/vault/vaultLargeFileManagement";

interface VaultLargeFilesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  items: VaultLargeFileItem[];
  sortedItems: VaultLargeFileItem[];
  selectedIds: ReadonlySet<string>;
  selectedBytes: number;
  deleting: boolean;
  sortBy: VaultLargeFileSort;
  onSortChange: (sortBy: VaultLargeFileSort) => void;
  onToggle: (id: string) => void;
  onDelete: () => void;
  formatStorageSize: (bytes: number) => string;
}

export function VaultLargeFilesDialog({
  open,
  onOpenChange,
  loading,
  items,
  sortedItems,
  selectedIds,
  selectedBytes,
  deleting,
  sortBy,
  onSortChange,
  onToggle,
  onDelete,
  formatStorageSize,
}: VaultLargeFilesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Manage Large Files
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <HardDrive className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>No files with size data found</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Sort:</span>
                  <Select value={sortBy} onValueChange={(value) => onSortChange(value as VaultLargeFileSort)}>
                    <SelectTrigger className="w-[110px] h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="size">Size</SelectItem>
                      <SelectItem value="date">Date</SelectItem>
                      <SelectItem value="type">Type</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <span className="text-sm text-muted-foreground">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} selected (${formatStorageSize(selectedBytes)})`
                    : `${items.length} files`}
                </span>
                {selectedIds.size > 0 && (
                  <Button variant="destructive" size="sm" onClick={onDelete} disabled={deleting}>
                    {deleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                    Delete
                  </Button>
                )}
              </div>
              <div className="overflow-y-auto flex-1 space-y-2 pr-1">
                {sortedItems.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${selectedIds.has(item.id) ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                    onClick={() => onToggle(item.id)}
                  >
                    <Checkbox checked={selectedIds.has(item.id)} onCheckedChange={() => onToggle(item.id)} onClick={(event) => event.stopPropagation()} />
                    <div className={`p-1.5 rounded ${item.type === "photo" ? "bg-primary/10" : "bg-muted"}`}>
                      {item.type === "photo" ? <FileImage className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.teamName ? `${item.teamName} • ` : ""}{format(new Date(item.createdAt), "MMM d, yyyy")}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-foreground shrink-0">{formatStorageSize(item.size)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
