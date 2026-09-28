import { useState, useEffect, useRef } from "react";
import { FolderPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateFolder: (name: string) => void;
  isCreating?: boolean;
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  onCreateFolder,
  isCreating = false,
}: CreateFolderDialogProps) {
  const [folderName, setFolderName] = useState("");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const isMobile = useIsMobile();
  const inputRef = useRef<HTMLInputElement>(null);

  // Detect keyboard visibility on mobile
  useEffect(() => {
    if (!isMobile) return;
    
    const handleResize = () => {
      // On mobile, when keyboard opens, window height shrinks significantly
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const windowHeight = window.screen.height;
      setKeyboardVisible(viewportHeight < windowHeight * 0.75);
    };

    window.visualViewport?.addEventListener('resize', handleResize);
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.removeEventListener('resize', handleResize);
    };
  }, [isMobile]);

  const handleCreate = () => {
    if (folderName.trim()) {
      onCreateFolder(folderName.trim());
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setFolderName("");
      setKeyboardVisible(false);
    }
    onOpenChange(newOpen);
  };

  const content = (
    <>
      <div className="py-4 px-1">
        <Input
          ref={inputRef}
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          placeholder="Folder name"
          className="h-12"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && folderName.trim() && !isCreating) {
              handleCreate();
            }
          }}
        />
      </div>
      <div className="flex gap-2 p-4 pt-0">
        <Button
          variant="outline"
          onClick={() => handleOpenChange(false)}
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
    </>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent 
          className={keyboardVisible ? "h-[100dvh] rounded-none" : ""}
        >
          <div className={keyboardVisible 
            ? "flex flex-col h-full" 
            : "mx-auto w-full max-w-lg px-4 pb-safe"
          }>
            <DrawerHeader className={keyboardVisible ? "pt-4" : ""}>
              <DrawerTitle className="flex items-center gap-2">
                <FolderPlus className="h-5 w-5 text-primary" />
                Create New Folder
              </DrawerTitle>
            </DrawerHeader>
            {content}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-primary" />
            Create New Folder
          </DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
