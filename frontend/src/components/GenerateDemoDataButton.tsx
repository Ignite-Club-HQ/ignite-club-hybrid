import { useState, useEffect } from "react";
import { Database, Loader2, Sparkles, Trash2, Users, LayoutGrid, LogIn, MessageSquare, Heart, FolderArchive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { refreshSessionOnce } from "@/lib/refreshSessionOnce";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface GenerateOptions {
  clubs: boolean;
  teams: boolean;
  events: boolean;
  photos: boolean;
  users: boolean;
  formations: boolean;
  messages: boolean;
  photoEngagement: boolean;
  vaultFiles: boolean;
}

interface DemoUser {
  id: string;
  name: string;
  email: string;
  password: string;
  roles?: string[];
  clubs?: string[];
  teams?: string[];
}

export function GenerateDemoDataButton() {
  const { signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<string[] | null>(null);
  const [activeTab, setActiveTab] = useState<"generate" | "delete" | "login">("generate");
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loggingInAs, setLoggingInAs] = useState<string | null>(null);
  const [options, setOptions] = useState<GenerateOptions>({
    clubs: true,
    teams: true,
    events: true,
    photos: false,
    users: true,
    formations: true,
    messages: true,
    photoEngagement: true,
    vaultFiles: true,
  });

  const toggleOption = (key: keyof GenerateOptions) => {
    setOptions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const fetchDemoUsers = async () => {
    setLoadingUsers(true);
    try {
      // Refresh session to ensure we have a valid token
      const { session, error: sessionError } = await refreshSessionOnce(10000);
      if (sessionError || !session) {
        console.error("Session error:", sessionError);
        toast.error("Session expired. Please refresh the page.");
        return;
      }

      const response = await fetch(
        `REDACTED_LAB_VALUE/functions/v1/generate-demo-data`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ action: "list" }),
        }
      );

      const data = await response.json();
      if (response.ok && data.users) {
        setDemoUsers(data.users);
      } else if (response.status === 401) {
        toast.error(data.message || "Session expired. Please refresh the page.");
      }
    } catch (error) {
      console.error("Error fetching demo users:", error);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === "login") {
      fetchDemoUsers();
    }
  }, [isOpen, activeTab]);

  const handleLoginAs = async (user: DemoUser) => {
    setLoggingInAs(user.id);
    try {
      // First sign out current user and unregister native push for this device
      await signOut();
      
      // Then sign in as demo user
      const { error } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: user.password,
      });

      if (error) {
        throw error;
      }

      toast.success(`Logged in as ${user.name}`);
      setIsOpen(false);
      // Reload to refresh the app state
      window.location.reload();
    } catch (error) {
      console.error("Error logging in as demo user:", error);
      toast.error(error instanceof Error ? error.message : "Failed to login as demo user");
    } finally {
      setLoggingInAs(null);
    }
  };

  const handleAction = async (action: "generate" | "delete") => {
    if (!options.clubs && !options.teams && !options.events && !options.photos && !options.users && !options.formations && !options.messages && !options.photoEngagement && !options.vaultFiles) {
      toast.error("Please select at least one type of data");
      return;
    }

    setIsLoading(true);
    setResults(null);

    try {
      // Refresh session to ensure we have a valid token
      const { session, error: sessionError } = await refreshSessionOnce(10000);
      if (sessionError || !session) {
        toast.error("Session expired. Please refresh the page and try again.");
        return;
      }

      const response = await fetch(
        `REDACTED_LAB_VALUE/functions/v1/generate-demo-data`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ ...options, action }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        // Use the message field if available for better error messages
        throw new Error(data.message || data.error || `Failed to ${action} demo data`);
      }

      setResults(data.details);
      toast.success(action === "generate" ? "Demo data generated!" : "Demo data deleted!");
    } catch (error) {
      console.error(`Error ${action}ing demo data:`, error);
      toast.error(error instanceof Error ? error.message : `Failed to ${action} demo data`);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedCount = Object.values(options).filter(Boolean).length;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Sparkles className="h-4 w-4" />
          Demo Data
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl w-[95vw] h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Demo Data Manager
          </DialogTitle>
          <DialogDescription>
            Generate, delete, or login as demo users.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden px-6">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="h-full flex flex-col">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="generate" className="gap-1.5 text-xs">
                <Sparkles className="h-3.5 w-3.5" />
                Generate
              </TabsTrigger>
              <TabsTrigger value="delete" className="gap-1.5 text-xs">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </TabsTrigger>
              <TabsTrigger value="login" className="gap-1.5 text-xs">
                <LogIn className="h-3.5 w-3.5" />
                Login As
              </TabsTrigger>
            </TabsList>

            <TabsContent value="generate" className="flex-1 overflow-auto pt-4">
              <p className="text-sm text-muted-foreground mb-4">
                Select what demo content to create. You will be added as admin to all created content.
              </p>
              <OptionsCheckboxes options={options} toggleOption={toggleOption} isGenerate />
            </TabsContent>

            <TabsContent value="delete" className="flex-1 overflow-auto pt-4">
              <p className="text-sm text-muted-foreground mb-4">
                Select what demo content to delete. Only removes demo data (Riverside FC, Northern United, Eastside Athletic clubs and their related data).
              </p>
              <OptionsCheckboxes options={options} toggleOption={toggleOption} isGenerate={false} />
            </TabsContent>

          <TabsContent value="login" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              Login as a demo user to test the app from their perspective.
            </p>
            {loadingUsers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : demoUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No demo users found.</p>
                <p className="text-xs">Generate demo data with "Players" checked first.</p>
              </div>
            ) : (
              <ScrollArea className="h-[50vh] max-h-[400px]">
                <div className="space-y-2 pr-4">
                  {demoUsers.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-2 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{user.name}</p>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {user.roles && user.roles.length > 0 ? (
                            <>
                              {user.roles.map((role, i) => {
                                const teamName = user.teams?.[i];
                                const clubName = user.clubs?.[i];
                                let context = '';
                                if (clubName && teamName) {
                                  context = ` (${clubName} - ${teamName})`;
                                } else if (clubName) {
                                  context = ` (${clubName})`;
                                } else if (teamName) {
                                  context = ` (${teamName})`;
                                }
                                return (
                                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-medium">
                                    {role}{context}
                                  </span>
                                );
                              })}
                            </>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">No roles assigned</span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-2 shrink-0"
                        onClick={() => handleLoginAs(user)}
                        disabled={loggingInAs === user.id}
                      >
                        {loggingInAs === user.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <LogIn className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
          </Tabs>
        </div>

        {/* Results */}
        {results && results.length > 0 && activeTab !== "login" && (
          <div className="mx-6 p-3 bg-muted rounded-lg max-h-32 overflow-y-auto">
            <p className="text-xs font-medium mb-2">Results:</p>
            {results.map((result, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {result}
              </p>
            ))}
          </div>
        )}

        {activeTab !== "login" && (
          <DialogFooter className="p-6 pt-4">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => handleAction(activeTab)}
              disabled={isLoading || selectedCount === 0}
              variant={activeTab === "delete" ? "destructive" : "default"}
              className="gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {activeTab === "generate" ? "Generating..." : "Deleting..."}
                </>
              ) : (
                <>
                  {activeTab === "generate" ? (
                    <Sparkles className="h-4 w-4" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  {activeTab === "generate" ? `Generate (${selectedCount})` : `Delete (${selectedCount})`}
                </>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface OptionsCheckboxesProps {
  options: GenerateOptions;
  toggleOption: (key: keyof GenerateOptions) => void;
  isGenerate: boolean;
}

function OptionsCheckboxes({ options, toggleOption, isGenerate }: OptionsCheckboxesProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="flex items-start space-x-3">
        <Checkbox
          id="clubs"
          checked={options.clubs}
          onCheckedChange={() => toggleOption("clubs")}
        />
        <div className="grid gap-1 leading-none">
          <Label htmlFor="clubs" className="font-medium cursor-pointer">
            Clubs
          </Label>
          <p className="text-xs text-muted-foreground">
            {isGenerate 
              ? "3 sample clubs (Riverside FC, Northern United, Eastside Athletic)"
              : "Delete demo clubs and all related data"}
          </p>
        </div>
      </div>

      <div className="flex items-start space-x-3">
        <Checkbox
          id="teams"
          checked={options.teams}
          onCheckedChange={() => toggleOption("teams")}
        />
        <div className="grid gap-1 leading-none">
          <Label htmlFor="teams" className="font-medium cursor-pointer">
            Teams
          </Label>
          <p className="text-xs text-muted-foreground">
            {isGenerate 
              ? "2 teams per club (U12 Boys, U10 Girls) with Pro subscriptions"
              : "Delete teams from demo clubs"}
          </p>
        </div>
      </div>

      <div className="flex items-start space-x-3">
        <Checkbox
          id="users"
          checked={options.users}
          onCheckedChange={() => toggleOption("users")}
        />
        <div className="grid gap-1 leading-none">
          <Label htmlFor="users" className="font-medium cursor-pointer flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Players
          </Label>
          <p className="text-xs text-muted-foreground">
            {isGenerate 
              ? "9 demo players per team with jersey numbers & positions"
              : "Delete demo player accounts"}
          </p>
        </div>
      </div>

      <div className="flex items-start space-x-3">
        <Checkbox
          id="events"
          checked={options.events}
          onCheckedChange={() => toggleOption("events")}
        />
        <div className="grid gap-1 leading-none">
          <Label htmlFor="events" className="font-medium cursor-pointer">
            Events
          </Label>
          <p className="text-xs text-muted-foreground">
            {isGenerate 
              ? "3 upcoming events per team (training, matches, social)"
              : "Delete events from demo clubs"}
          </p>
        </div>
      </div>

      <div className="flex items-start space-x-3">
        <Checkbox
          id="formations"
          checked={options.formations}
          onCheckedChange={() => toggleOption("formations")}
        />
        <div className="grid gap-1 leading-none">
          <Label htmlFor="formations" className="font-medium cursor-pointer flex items-center gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5" />
            Formations
          </Label>
          <p className="text-xs text-muted-foreground">
            {isGenerate 
              ? "3 pitch formations per team (4-3-3, 4-4-2, 3-5-2)"
              : "Delete pitch formations from demo teams"}
          </p>
        </div>
      </div>

      <div className="flex items-start space-x-3">
        <Checkbox
          id="photos"
          checked={options.photos}
          onCheckedChange={() => toggleOption("photos")}
        />
        <div className="grid gap-1 leading-none">
          <Label htmlFor="photos" className="font-medium cursor-pointer">
            Photos
          </Label>
          <p className="text-xs text-muted-foreground">
            {isGenerate 
              ? "Demo sports photos (requires Pro at club or team level)"
              : "Delete all demo photos (Unsplash URLs)"}
          </p>
        </div>
      </div>

      <div className="flex items-start space-x-3">
        <Checkbox
          id="messages"
          checked={options.messages}
          onCheckedChange={() => toggleOption("messages")}
        />
        <div className="grid gap-1 leading-none">
          <Label htmlFor="messages" className="font-medium cursor-pointer flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Chat Messages
          </Label>
          <p className="text-xs text-muted-foreground">
            {isGenerate 
              ? "Demo messages in team and club chat threads"
              : "Delete demo chat messages"}
          </p>
        </div>
      </div>

      <div className="flex items-start space-x-3">
        <Checkbox
          id="photoEngagement"
          checked={options.photoEngagement}
          onCheckedChange={() => toggleOption("photoEngagement")}
        />
        <div className="grid gap-1 leading-none">
          <Label htmlFor="photoEngagement" className="font-medium cursor-pointer flex items-center gap-1.5">
            <Heart className="h-3.5 w-3.5" />
            Photo Engagement
          </Label>
          <p className="text-xs text-muted-foreground">
            {isGenerate 
              ? "Reactions and comments on demo photos"
              : "Delete photo reactions and comments"}
          </p>
        </div>
      </div>

      <div className="flex items-start space-x-3">
        <Checkbox
          id="vaultFiles"
          checked={options.vaultFiles}
          onCheckedChange={() => toggleOption("vaultFiles")}
        />
        <div className="grid gap-1 leading-none">
          <Label htmlFor="vaultFiles" className="font-medium cursor-pointer flex items-center gap-1.5">
            <FolderArchive className="h-3.5 w-3.5" />
            Vault Files
          </Label>
          <p className="text-xs text-muted-foreground">
            {isGenerate 
              ? "Club documents in organized folders (requires Pro)"
              : "Delete demo vault files and folders"}
          </p>
        </div>
      </div>
    </div>
  );
}
