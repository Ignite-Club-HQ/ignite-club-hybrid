import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, X, Building2, User as UserIcon, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageLoading } from "@/components/ui/page-loading";
import { toast } from "sonner";

import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabDmAttachments } from "@/lab/fixtureDataLayer";

export default function AdminDmAttachmentsPage() {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  if (useIcpLab) {
    return <IcpLabAdminDmAttachmentsPage />;
  }
  return <SupabaseAdminDmAttachmentsPage />;
}

/** Read-only synthetic DM-attachment list; flagging and removal remain unavailable until media_metadata admin tooling is wired here. */
function IcpLabAdminDmAttachmentsPage() {
  const navigate = useNavigate();
  const attachments = getLocalLabDmAttachments();

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">DM Attachments</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Showing synthetic ICP lab attachment metadata. Flagging and removal are disabled.
      </p>
      <div className="space-y-2">
        {attachments.map((attachment) => (
          <Card key={attachment.id}>
            <CardContent className="p-4">
              <p className="text-sm font-medium">{attachment.caption}</p>
              <p className="text-xs text-muted-foreground">Uploaded by {attachment.uploaded_by}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SupabaseAdminDmAttachmentsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"club" | "user">("club");

  const { data: isAppAdmin, isLoading: checkingAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id,
  });

  const { data: restrictions, isLoading } = useQuery({
    queryKey: ["dm-attachment-restrictions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dm_attachment_restrictions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!isAppAdmin,
  });

  const { data: clubs } = useQuery({
    queryKey: ["all-clubs-min"],
    queryFn: async () => {
      const { data } = await supabase.from("clubs").select("id, name").order("name");
      return data || [];
    },
    enabled: !!isAppAdmin,
  });

  const restrictedClubIds = new Set((restrictions || []).filter((r: any) => r.scope === "club").map((r: any) => r.club_id));
  const restrictedUserIds = new Set((restrictions || []).filter((r: any) => r.scope === "user").map((r: any) => r.user_id));

  const { data: restrictedUserProfiles } = useQuery({
    queryKey: ["dm-restriction-user-profiles", Array.from(restrictedUserIds).sort().join(",")],
    queryFn: async () => {
      if (restrictedUserIds.size === 0) return [];
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, email")
        .in("id", Array.from(restrictedUserIds));
      return data || [];
    },
    enabled: !!isAppAdmin,
  });

  const addClubMutation = useMutation({
    mutationFn: async (clubId: string) => {
      const { error } = await supabase
        .from("dm_attachment_restrictions")
        .insert({ scope: "club", club_id: clubId, created_by: user!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dm-attachment-restrictions"] });
      toast.success("Club restricted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("dm_attachment_restrictions")
        .insert({ scope: "user", user_id: userId, created_by: user!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dm-attachment-restrictions"] });
      qc.invalidateQueries({ queryKey: ["dm-restriction-user-profiles"] });
      toast.success("User restricted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("dm_attachment_restrictions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dm-attachment-restrictions"] });
      toast.success("Restriction removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [selectedClub, setSelectedClub] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [searchedUsers, setSearchedUsers] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearchUsers = async () => {
    const q = userSearch.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, email")
        .or(`display_name.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(20);
      setSearchedUsers(data || []);
    } finally {
      setSearching(false);
    }
  };

  if (checkingAdmin) return <PageLoading />;

  if (!isAppAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">DM Attachments</h1>
        </div>
        <p className="text-muted-foreground px-4">Access denied. App admin role required.</p>
      </div>
    );
  }

  const clubRestrictions = (restrictions || []).filter((r: any) => r.scope === "club");
  const userRestrictions = (restrictions || []).filter((r: any) => r.scope === "user");
  const profileById = new Map((restrictedUserProfiles || []).map((p: any) => [p.id, p]));

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">DM Attachments</h1>
          <p className="text-sm text-muted-foreground">
            Disable the "+" attachment menu in direct messages by club or by user
          </p>
        </div>
      </div>

      <div className="flex gap-2 px-1">
        <Button variant={tab === "club" ? "default" : "outline"} size="sm" onClick={() => setTab("club")} className="gap-1">
          <Building2 className="h-4 w-4" /> By Club
        </Button>
        <Button variant={tab === "user" ? "default" : "outline"} size="sm" onClick={() => setTab("user")} className="gap-1">
          <UserIcon className="h-4 w-4" /> By User
        </Button>
      </div>

      {tab === "club" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Restricted Clubs</CardTitle>
            <CardDescription>
              Members of these clubs cannot attach images, vault files, events, or boards in DMs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Select value={selectedClub} onValueChange={setSelectedClub}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Choose a club to restrict..." />
                </SelectTrigger>
                <SelectContent>
                  {(clubs || [])
                    .filter((c: any) => !restrictedClubIds.has(c.id))
                    .map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                onClick={() => {
                  if (selectedClub) {
                    addClubMutation.mutate(selectedClub);
                    setSelectedClub("");
                  }
                }}
                disabled={!selectedClub || addClubMutation.isPending}
                size="icon"
              >
                {addClubMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : clubRestrictions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No clubs restricted</p>
            ) : (
              <div className="space-y-2">
                {clubRestrictions.map((r: any) => {
                  const club = clubs?.find((c: any) => c.id === r.club_id);
                  return (
                    <div key={r.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{club?.name || r.club_id}</span>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeMutation.mutate(r.id)}
                        disabled={removeMutation.isPending}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "user" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Restricted Users</CardTitle>
            <CardDescription>
              These users cannot attach images, vault files, events, or boards in DMs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search by name or email..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearchUsers()}
              />
              <Button onClick={handleSearchUsers} disabled={searching || userSearch.trim().length < 2} size="icon">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {searchedUsers.length > 0 && (
              <div className="space-y-2 border rounded-lg p-2 bg-muted/30">
                <p className="text-xs text-muted-foreground px-1">Search results</p>
                {searchedUsers.map((u) => {
                  const isRestricted = restrictedUserIds.has(u.id);
                  return (
                    <div key={u.id} className="flex items-center justify-between p-2 rounded bg-background">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{u.display_name || "(no name)"}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                      {isRestricted ? (
                        <Badge variant="secondary">Restricted</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => addUserMutation.mutate(u.id)}
                          disabled={addUserMutation.isPending}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Restrict
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : userRestrictions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No users restricted</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground px-1">Currently restricted</p>
                {userRestrictions.map((r: any) => {
                  const profile: any = profileById.get(r.user_id);
                  return (
                    <div key={r.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{profile?.display_name || r.user_id}</p>
                        {profile?.email && (
                          <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
                        )}
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeMutation.mutate(r.id)}
                        disabled={removeMutation.isPending}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
