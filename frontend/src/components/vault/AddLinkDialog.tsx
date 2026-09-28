import { useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";

interface AddLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddLink: (url: string, name: string) => void;
  isAdding?: boolean;
  targetName: string;
}

// Helper to detect link type from URL
function detectLinkType(url: string): { type: string; icon: string; color: string } {
  const lowerUrl = url.toLowerCase();
  
  // Google Suite
  if (lowerUrl.includes('docs.google.com/document')) {
    return { type: 'Google Doc', icon: '📄', color: 'text-blue-600' };
  }
  if (lowerUrl.includes('docs.google.com/spreadsheets')) {
    return { type: 'Google Sheet', icon: '📊', color: 'text-green-600' };
  }
  if (lowerUrl.includes('docs.google.com/presentation')) {
    return { type: 'Google Slides', icon: '📽️', color: 'text-yellow-600' };
  }
  if (lowerUrl.includes('docs.google.com/forms')) {
    return { type: 'Google Form', icon: '📋', color: 'text-purple-600' };
  }
  if (lowerUrl.includes('drive.google.com')) {
    return { type: 'Google Drive', icon: '📁', color: 'text-blue-500' };
  }
  
  // Cloud Storage
  if (lowerUrl.includes('dropbox.com')) {
    return { type: 'Dropbox', icon: '📦', color: 'text-blue-500' };
  }
  if (lowerUrl.includes('box.com') || lowerUrl.includes('app.box.com')) {
    return { type: 'Box', icon: '📦', color: 'text-blue-600' };
  }
  if (lowerUrl.includes('icloud.com')) {
    return { type: 'iCloud', icon: '☁️', color: 'text-gray-600' };
  }
  
  // Microsoft
  if (lowerUrl.includes('onedrive.live.com') || lowerUrl.includes('1drv.ms')) {
    return { type: 'OneDrive', icon: '☁️', color: 'text-blue-600' };
  }
  if (lowerUrl.includes('sharepoint.com') && lowerUrl.includes('word')) {
    return { type: 'Word Online', icon: '📄', color: 'text-blue-700' };
  }
  if (lowerUrl.includes('sharepoint.com') && lowerUrl.includes('excel')) {
    return { type: 'Excel Online', icon: '📊', color: 'text-green-700' };
  }
  if (lowerUrl.includes('sharepoint.com') && lowerUrl.includes('powerpoint')) {
    return { type: 'PowerPoint Online', icon: '📽️', color: 'text-orange-600' };
  }
  if (lowerUrl.includes('sharepoint.com')) {
    return { type: 'SharePoint', icon: '📁', color: 'text-teal-600' };
  }
  if (lowerUrl.includes('live.com') && lowerUrl.includes('word')) {
    return { type: 'Word Online', icon: '📄', color: 'text-blue-700' };
  }
  if (lowerUrl.includes('live.com') && lowerUrl.includes('excel')) {
    return { type: 'Excel Online', icon: '📊', color: 'text-green-700' };
  }
  if (lowerUrl.includes('live.com') && lowerUrl.includes('powerpoint')) {
    return { type: 'PowerPoint Online', icon: '📽️', color: 'text-orange-600' };
  }
  if (lowerUrl.includes('office.com') || lowerUrl.includes('office365.com') || lowerUrl.includes('officeppe.com')) {
    return { type: 'Microsoft 365', icon: '📄', color: 'text-orange-600' };
  }
  
  // Note-taking & Docs
  if (lowerUrl.includes('notion.so') || lowerUrl.includes('notion.site')) {
    return { type: 'Notion', icon: '📝', color: 'text-gray-800' };
  }
  if (lowerUrl.includes('coda.io')) {
    return { type: 'Coda', icon: '📄', color: 'text-orange-500' };
  }
  if (lowerUrl.includes('quip.com')) {
    return { type: 'Quip', icon: '📄', color: 'text-blue-500' };
  }
  if (lowerUrl.includes('evernote.com')) {
    return { type: 'Evernote', icon: '🐘', color: 'text-green-600' };
  }
  
  // Design Tools
  if (lowerUrl.includes('figma.com')) {
    return { type: 'Figma', icon: '🎨', color: 'text-purple-500' };
  }
  if (lowerUrl.includes('canva.com')) {
    return { type: 'Canva', icon: '🎨', color: 'text-cyan-500' };
  }
  if (lowerUrl.includes('miro.com')) {
    return { type: 'Miro', icon: '🖼️', color: 'text-yellow-500' };
  }
  if (lowerUrl.includes('lucid.app') || lowerUrl.includes('lucidchart.com')) {
    return { type: 'Lucidchart', icon: '📊', color: 'text-orange-500' };
  }
  if (lowerUrl.includes('whimsical.com')) {
    return { type: 'Whimsical', icon: '✨', color: 'text-purple-400' };
  }
  
  // Project Management
  if (lowerUrl.includes('trello.com')) {
    return { type: 'Trello', icon: '📋', color: 'text-blue-500' };
  }
  if (lowerUrl.includes('asana.com')) {
    return { type: 'Asana', icon: '✅', color: 'text-pink-500' };
  }
  if (lowerUrl.includes('monday.com')) {
    return { type: 'Monday', icon: '📊', color: 'text-red-500' };
  }
  if (lowerUrl.includes('clickup.com')) {
    return { type: 'ClickUp', icon: '✨', color: 'text-purple-500' };
  }
  if (lowerUrl.includes('basecamp.com')) {
    return { type: 'Basecamp', icon: '🏕️', color: 'text-green-600' };
  }
  
  // Databases & Tables
  if (lowerUrl.includes('airtable.com')) {
    return { type: 'Airtable', icon: '📊', color: 'text-blue-400' };
  }
  if (lowerUrl.includes('smartsheet.com')) {
    return { type: 'Smartsheet', icon: '📊', color: 'text-blue-600' };
  }
  
  // Collaboration
  if (lowerUrl.includes('confluence.atlassian.com') || lowerUrl.includes('atlassian.net/wiki')) {
    return { type: 'Confluence', icon: '📖', color: 'text-blue-600' };
  }
  if (lowerUrl.includes('slack.com')) {
    return { type: 'Slack', icon: '💬', color: 'text-purple-500' };
  }
  
  // Other
  if (lowerUrl.includes('zoho.com')) {
    return { type: 'Zoho', icon: '📄', color: 'text-red-500' };
  }
  if (lowerUrl.includes('prezi.com')) {
    return { type: 'Prezi', icon: '📽️', color: 'text-blue-500' };
  }
  if (lowerUrl.includes('loom.com')) {
    return { type: 'Loom', icon: '🎥', color: 'text-purple-600' };
  }
  
  return { type: 'External Link', icon: '🔗', color: 'text-muted-foreground' };
}

// Helper to extract a suggested name from URL
function suggestNameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    
    // For Google Docs, try to extract title from path
    if (url.includes('docs.google.com/document')) {
      // Google Docs URLs often have /d/{id}/edit - we can't extract title from URL
      return 'Google Doc';
    }
    if (url.includes('docs.google.com/spreadsheets')) {
      return 'Google Sheet';
    }
    if (url.includes('docs.google.com/presentation')) {
      return 'Google Slides';
    }
    
    // For other URLs, try to get something meaningful
    const lastPart = pathParts[pathParts.length - 1];
    if (lastPart && !lastPart.match(/^[a-zA-Z0-9_-]{25,}$/)) {
      // If it's not just a random ID, use it as name
      return decodeURIComponent(lastPart).replace(/[-_]/g, ' ');
    }
    
    return urlObj.hostname.replace('www.', '');
  } catch {
    return 'External Link';
  }
}

// Validate URL
function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    // Try adding https:// prefix
    try {
      const urlObj = new URL(`https://${url}`);
      return urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  }
}

export function AddLinkDialog({
  open,
  onOpenChange,
  onAddLink,
  isAdding = false,
  targetName,
}: AddLinkDialogProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [urlTouched, setUrlTouched] = useState(false);

  // Normalize URL (add https:// if missing)
  const normalizeUrl = (inputUrl: string): string => {
    if (!inputUrl) return "";
    if (inputUrl.startsWith('http://') || inputUrl.startsWith('https://')) {
      return inputUrl;
    }
    return `https://${inputUrl}`;
  };

  const normalizedUrl = normalizeUrl(url);
  const isValid = url.length > 0 && isValidUrl(url);
  const linkInfo = isValid ? detectLinkType(normalizedUrl) : null;

  const handleUrlChange = (value: string) => {
    setUrl(value);
    setUrlTouched(true);
    
    // Auto-suggest name if empty
    if (!name && isValidUrl(value)) {
      setName(suggestNameFromUrl(normalizeUrl(value)));
    }
  };

  const handleAddLink = () => {
    if (isValid && name.trim()) {
      onAddLink(normalizedUrl, name.trim());
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset form
      setUrl("");
      setName("");
      setUrlTouched(false);
    }
    onOpenChange(newOpen);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Add Link to {targetName}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="link-url">Link URL</Label>
            <Input
              id="link-url"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://reference.invalid"
              className={urlTouched && url && !isValid ? "border-destructive" : ""}
            />
            {urlTouched && url && !isValid && (
              <p className="text-xs text-destructive">Please enter a valid URL</p>
            )}
          </div>

          {isValid && linkInfo && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
              <span className="text-xl">{linkInfo.icon}</span>
              <div className="flex-1">
                <p className={`text-sm font-medium ${linkInfo.color}`}>{linkInfo.type}</p>
                <p className="text-xs text-muted-foreground truncate">{normalizedUrl}</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="link-name">Display Name</Label>
            <Input
              id="link-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Document"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            💡 Tip: Add links to Google Docs, Sheets, or other cloud documents. 
            Clicking the link will open the live document for editing.
          </p>
        </div>

        <ResponsiveDialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            onClick={handleAddLink}
            disabled={!isValid || !name.trim() || isAdding}
            className="flex-1 sm:flex-none"
          >
            {isAdding ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Link2 className="h-4 w-4 mr-2" />
                Add Link
              </>
            )}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
