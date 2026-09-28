import { useState, useEffect } from "react";
import { Folder, FolderPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

export const FOLDER_COLORS = [
  { value: "default", label: "Default", className: "text-foreground", bgClassName: "" },
  { value: "blue", label: "Blue", className: "text-blue-500", bgClassName: "bg-blue-500/10" },
  { value: "green", label: "Green", className: "text-green-500", bgClassName: "bg-green-500/10" },
  { value: "yellow", label: "Yellow", className: "text-yellow-500", bgClassName: "bg-yellow-500/10" },
  { value: "red", label: "Red", className: "text-red-500", bgClassName: "bg-red-500/10" },
  { value: "purple", label: "Purple", className: "text-purple-500", bgClassName: "bg-purple-500/10" },
  { value: "orange", label: "Orange", className: "text-orange-500", bgClassName: "bg-orange-500/10" },
  { value: "pink", label: "Pink", className: "text-pink-500", bgClassName: "bg-pink-500/10" },
];

interface CreateTeamFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateFolder: (name: string, description: string, color: string) => void;
  isCreating?: boolean;
  classMode?: boolean;
}

export function CreateTeamFolderDialog({
  open,
  onOpenChange,
  onCreateFolder,
  isCreating = false,
  classMode = false,
}: CreateTeamFolderDialogProps) {
  const [folderName, setFolderName] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [folderColor, setFolderColor] = useState("default");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const isMobile = useIsMobile();

  // Detect keyboard visibility on mobile
  useEffect(() => {
    if (!isMobile || !open) {
      setKeyboardVisible(false);
      return;
    }
    
    const handleResize = () => {
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const windowHeight = window.screen.height;
      setKeyboardVisible(viewportHeight < windowHeight * 0.75);
    };

    window.visualViewport?.addEventListener('resize', handleResize);
    window.addEventListener('resize', handleResize);
    handleResize();
    
    return () => {
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.removeEventListener('resize', handleResize);
    };
  }, [isMobile, open]);

  // Reset state when closing
  useEffect(() => {
    if (!open) {
      // Small delay to allow close animation
      const timer = setTimeout(() => {
        setFolderName("");
        setFolderDescription("");
        setFolderColor("default");
        setKeyboardVisible(false);
        // Remove focus from any focused element to prevent blue button state
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const handleCreate = () => {
    if (folderName.trim()) {
      onCreateFolder(folderName.trim(), folderDescription.trim(), folderColor);
    }
  };

  const formContent = (
    <div className={keyboardVisible ? "space-y-3" : "space-y-4"}>
      {/* Folder Name Input */}
      <div className="space-y-1">
        <Input
          id="folder-name"
          placeholder="Folder name"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          className="h-12"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && folderName.trim() && !isCreating) {
              handleCreate();
            }
          }}
        />
        {!keyboardVisible && (
          <p className="text-sm text-muted-foreground text-center">
            Organize your {classMode ? "classes" : "teams"} into folders
          </p>
        )}
      </div>

      {/* Description - hide when keyboard visible */}
      {!keyboardVisible && (
        <div className="space-y-2">
          <Label htmlFor="folder-description" className="text-sm font-medium">
            Description (optional)
          </Label>
          <Textarea
            id="folder-description"
            placeholder="Optional description for this folder"
            value={folderDescription}
            onChange={(e) => setFolderDescription(e.target.value)}
            rows={2}
            className="resize-none"
          />
        </div>
      )}

      {/* Color Selection - always show, compact when keyboard visible */}
      <div className={keyboardVisible ? "space-y-2" : "space-y-3"}>
        <Label className="text-sm font-medium">Folder Color</Label>
        <div className="flex flex-wrap justify-center gap-3">
          {FOLDER_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              onClick={() => setFolderColor(color.value)}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${color.bgClassName || "bg-muted"} ${
                folderColor === color.value ? "ring-2 ring-offset-2 ring-primary scale-110" : "hover:scale-105"
              }`}
            >
              <Folder className={`h-5 w-5 ${color.className}`} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const actionButtons = (
    <div className="flex gap-2">
      <Button
        variant="outline"
        onClick={() => onOpenChange(false)}
        className="flex-1"
      >
        Cancel
      </Button>
      <Button
        onClick={handleCreate}
        disabled={!folderName.trim() || isCreating}
        className="flex-1"
      >
        {isCreating ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Creating...
          </>
        ) : (
          "Create"
        )}
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} autoFocus={false}>
        <DrawerContent>
          <div className="mx-auto w-full max-w-lg px-4 pb-safe">
            <DrawerHeader className="px-0">
              <DrawerTitle className="flex items-center gap-2">
                <FolderPlus className="h-5 w-5 text-primary" />
                Create {classMode ? "Class" : "Team"} Folder
              </DrawerTitle>
            </DrawerHeader>
            <div className="py-2">
              {formContent}
            </div>
            <div className="py-4">
              {actionButtons}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-primary" />
            Create {classMode ? "Class" : "Team"} Folder
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          {formContent}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          {actionButtons}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}