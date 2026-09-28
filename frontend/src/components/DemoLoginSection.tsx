import { useState, useEffect, useMemo } from "react";
import { Loader2, LogIn, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DemoUser {
  id: string;
  name: string;
  email: string;
  password: string;
  roles?: string[];
  clubs?: string[];
  teams?: string[];
  ignite_points?: number;
}

interface DemoLoginSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DemoLoginSection({ open, onOpenChange }: DemoLoginSectionProps) {
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loggingInAs, setLoggingInAs] = useState<string | null>(null);
  const [selectedClub, setSelectedClub] = useState<string>("all");

  const fetchDemoUsers = async () => {
    setLoadingUsers(true);
    try {
      const response = await fetch(
        `REDACTED_LAB_VALUE/functions/v1/generate-demo-data`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": "REDACTED_LAB_VALUE",
          },
          body: JSON.stringify({ action: "list-public" }),
        }
      );

      const data = await response.json();
      if (response.ok && data.users) {
        setDemoUsers(data.users);
      }
    } catch (error) {
      console.error("Error fetching demo users:", error);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (open && demoUsers.length === 0) {
      fetchDemoUsers();
    }
  }, [open]);

  // Extract unique clubs from demo users (filter out empty strings)
  const uniqueClubs = useMemo(() => {
    const clubs = new Set<string>();
    demoUsers.forEach(user => {
      user.clubs?.forEach(club => {
        if (club && club.trim()) {
          clubs.add(club);
        }
      });
    });
    return Array.from(clubs).sort();
  }, [demoUsers]);

  // Filter users by selected club (check if any of user's clubs matches)
  const filteredUsers = useMemo(() => {
    if (selectedClub === "all") return demoUsers;
    if (selectedClub === "unassociated") {
      return demoUsers.filter(user => !user.roles || user.roles.length === 0);
    }
    return demoUsers.filter(user => 
      user.clubs?.some(club => club === selectedClub)
    );
  }, [demoUsers, selectedClub]);

  // Check if there are unassociated users
  const hasUnassociatedUsers = useMemo(() => {
    return demoUsers.some(user => !user.roles || user.roles.length === 0);
  }, [demoUsers]);

  const handleLoginAs = async (demoUser: DemoUser) => {
    setLoggingInAs(demoUser.id);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: demoUser.email,
        password: demoUser.password,
      });

      if (error) {
        throw error;
      }

      // Wait for session to be established before closing dialog
      // This prevents auth redirect loops
      await new Promise<void>((resolve) => {
        const checkSession = async () => {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            resolve();
          } else {
            // Retry after a short delay
            setTimeout(checkSession, 100);
          }
        };
        checkSession();
        // Timeout after 5 seconds
        setTimeout(resolve, 5000);
      });

      toast.success(`Logged in as ${demoUser.name}`);
      onOpenChange(false);
    } catch (error) {
      console.error("Error logging in as demo user:", error);
      toast.error(error instanceof Error ? error.message : "Failed to login as demo user");
    } finally {
      setLoggingInAs(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Demo Accounts</DialogTitle>
          <DialogDescription>
            Login as a demo user to test different roles and permissions
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-hidden">
          {loadingUsers ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : demoUsers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No demo accounts available.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {uniqueClubs.length > 0 && (
                <Select value={selectedClub} onValueChange={setSelectedClub}>
                  <SelectTrigger className="w-full">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Filter by club" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Accounts</SelectItem>
                    {uniqueClubs.map(club => (
                      <SelectItem key={club} value={club}>{club}</SelectItem>
                    ))}
                    {hasUnassociatedUsers && (
                      <SelectItem value="unassociated">No Club (Unassociated)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
              
              <div className="max-h-[400px] overflow-y-auto space-y-2 pr-1">
                {filteredUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No users in this club</p>
                ) : (
                  filteredUsers.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {user.name}
                          <span className="ml-2 text-xs text-primary font-normal">
                            🔥 {user.ignite_points ?? 0}
                          </span>
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {user.roles && user.roles.length > 0 ? (
                            <>
                              {user.roles.slice(0, 2).map((role, i) => {
                                const clubName = user.clubs?.[i];
                                const teamName = user.teams?.[i];
                                let context = '';
                                if (clubName && !teamName) {
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
                              {user.roles.length > 2 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                  +{user.roles.length - 2} more
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">No roles</span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-3 shrink-0"
                        onClick={() => handleLoginAs(user)}
                        disabled={loggingInAs === user.id}
                      >
                        {loggingInAs === user.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <LogIn className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
