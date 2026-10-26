import { writeOnce } from "@/live/clubScope";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Trash2, Loader2, Search, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import { linkLiveGuardian, listLiveChildGuardians, unlinkLiveGuardian, setLiveGuardianRelationship } from "@/live/features/club";
import { grantLiveGuardianChildNameRead } from "@/live/features/vault";
import { readRelationshipProfiles } from "@/live/relationshipProfileRead";
import { Principal } from "@icp-sdk/core/principal";
import { useAuth } from '@/hooks/useAuth';

interface Guardian {
  id: string;
  guardian_id: string;
  relationship_type: string;
  is_primary: boolean;
  canRemove?: boolean;
  created_at: string;
  profiles: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface TeamMember {
  user_id: string;
  profiles: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface ManageGuardiansDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  childId: string;
  childName: string;
  teamIds: string[];
}

const relationshipTypes = [
  { value: "parent", label: "Parent" },
  { value: "guardian", label: "Guardian" },
  { value: "grandparent", label: "Grandparent" },
  { value: "stepparent", label: "Stepparent" },
  { value: "other", label: "Other" },
];

export default function ManageGuardiansDialog({
  open,
  onOpenChange,
  childId,
  childName,
  teamIds,
}: ManageGuardiansDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isIcp = resolveAuthBackend() === "icp";
  const { user: profileViewer } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [relationshipType, setRelationshipType] = useState("guardian");

  // Fetch current guardians
  const { data: guardians, isLoading: loadingGuardians } = useQuery({
    queryKey: ["child_guardians", childId, profileViewer?.id, resolveAuthBackend()],
    queryFn: async () => withFeatureBackend("membership", {
      supabase: async () => {
        const { data, error } = await supabase
          .from("child_guardians")
          .select("*, profiles:guardian_id(id, display_name, avatar_url)")
          .eq("child_id", childId)
          .order("is_primary", { ascending: false });
        if (error) throw error;
        return data as Guardian[];
      },
      icp: async (ctx) => {
        const principals = (await listLiveChildGuardians(ctx, childId)).map((principal) => principal.toText());
        const profiles = await readRelationshipProfiles(ctx, principals, { kind: 'family', resource: childId });
        const profileByPrincipal = new Map(profiles.map((profile: any) => [profile.account_id, profile]));
        return principals.map((principal) => {
          const profile = profileByPrincipal.get(principal) as any;
          return {
            id: principal,
            guardian_id: principal,
            relationship_type: "guardian",
            is_primary: false,
            canRemove: false,
            created_at: "",
            profiles: {
              id: principal,
              display_name: profile?.display_name ?? null,
              avatar_url: profile?.avatar_ref?.[0] ?? null,
            },
          } satisfies Guardian;
        });
      },
    }, { shared: 'person' }),
    enabled: open && !!childId,
  });

  // Fetch team members who could be guardians (parents in child's teams)
  const { data: potentialGuardians } = useQuery({
    queryKey: ["potential_guardians", teamIds, childId],
    queryFn: async () => {
      if (!teamIds.length) return [];
      if (isIcp) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, profiles:user_id(id, display_name, avatar_url)")
        .in("team_id", teamIds)
        .eq("role", "parent");
      if (error) throw error;
      
      // Deduplicate and filter out existing guardians
      const existingGuardianIds = guardians?.map(g => g.guardian_id) || [];
      const uniqueMembers = Array.from(
        new Map(
          (data as TeamMember[])
            .filter(m => m.profiles && !existingGuardianIds.includes(m.user_id))
            .map(m => [m.user_id, m])
        ).values()
      );
      return uniqueMembers;
    },
    enabled: open && teamIds.length > 0 && !!guardians && !isIcp,
  });

  // Filter by search
  const filteredGuardians = potentialGuardians?.filter(m => {
    if (!searchQuery) return true;
    const name = m.profiles?.display_name || "";
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  }) || [];

  // Add guardian mutation
  const addGuardian = useMutation({
    mutationFn: async () => {
      if (!selectedUserId) return;
      await withFeatureBackend("membership", {
        icp: async (ctx) => {
          const guardian = Principal.fromText(selectedUserId);
          await linkLiveGuardian(ctx, childId, guardian);
          // Relationship metadata (type + is_primary) lives in a separate
          // record on club_domain — newly added guardians are never primary.
          await setLiveGuardianRelationship(ctx, childId, guardian, relationshipType, false);
          // Seed the new guardian's read grant on the child's PII name record
          // (best effort — never fails the link).
          await grantLiveGuardianChildNameRead(ctx, childId, guardian);
        },
        supabase: async () => {
          const { error } = await supabase.from("child_guardians").insert({
            child_id: childId,
            guardian_id: selectedUserId,
            relationship_type: relationshipType,
            is_primary: false,
          });
          if (error) throw error;
        },
      }, writeOnce({ shared: 'person' as const }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["child_guardians", childId] });
      queryClient.invalidateQueries({ queryKey: ["potential_guardians"] });
      setSelectedUserId(null);
      setRelationshipType("guardian");
      toast({ title: "Guardian added successfully" });
    },
    onError: (error: Error) => {
      if (error.message?.includes("duplicate")) {
        toast({ title: "This person is already a guardian", variant: "destructive" });
      } else {
        toast({ title: "Failed to add guardian", variant: "destructive" });
      }
    },
  });

  // Remove guardian mutation
  const removeGuardian = useMutation({
    mutationFn: async (guardianRecordId: string) => {
      await withFeatureBackend("membership", {
        icp: async (ctx) => {
          const guardian = guardians?.find((g) => g.id === guardianRecordId);
          if (!guardian) return;
          await unlinkLiveGuardian(ctx, childId, Principal.fromText(guardian.guardian_id));
        },
        supabase: async () => {
          const { error } = await supabase
            .from("child_guardians")
            .delete()
            .eq("id", guardianRecordId);
          if (error) throw error;
        },
      }, writeOnce({ shared: 'person' as const }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["child_guardians", childId] });
      queryClient.invalidateQueries({ queryKey: ["potential_guardians"] });
      toast({ title: "Guardian removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove guardian", variant: "destructive" });
    },
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Guardians for {childName}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="sr-only">
            Add or remove the parents and guardians assigned to this child.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4 pt-2">
          {/* Current Guardians */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Current Guardians</Label>
            {loadingGuardians ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : guardians?.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No guardians linked yet.</p>
            ) : (
              <div className="space-y-2">
                {guardians?.map((guardian) => (
                  <div
                    key={guardian.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                        {guardian.profiles?.display_name?.[0]?.toUpperCase() || "?"}
                      </div>
                      <div>
                        <p className="font-medium text-sm">
                          {guardian.profiles?.display_name || "Unknown"}
                        </p>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-xs capitalize">
                            {guardian.relationship_type}
                          </Badge>
                          {guardian.is_primary && (
                            <Badge variant="secondary" className="text-xs">
                              <Crown className="h-3 w-3 mr-1" />
                              Primary
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    {(guardian.canRemove ?? !guardian.is_primary) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeGuardian.mutate(guardian.id)}
                        disabled={removeGuardian.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add Guardian */}
          {isIcp && (
            <p role="status" className="border-t pt-3 text-sm text-muted-foreground">
              Adding or removing other guardians from this team is not available in ICP yet.
            </p>
          )}
          {potentialGuardians && potentialGuardians.length > 0 && (
            <div className="space-y-3 pt-2 border-t">
              <Label className="text-sm font-medium">Add Guardian</Label>
              
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search team parents..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <ScrollArea className="max-h-[150px]">
                <div className="space-y-1">
                  {filteredGuardians.map((member) => (
                    <button
                      key={member.user_id}
                      type="button"
                      onClick={() => setSelectedUserId(
                        selectedUserId === member.user_id ? null : member.user_id
                      )}
                      className={`w-full text-left p-2 rounded-md transition-colors ${
                        selectedUserId === member.user_id
                          ? "bg-primary/10 border border-primary"
                          : "hover:bg-accent"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                          {member.profiles?.display_name?.[0]?.toUpperCase() || "?"}
                        </div>
                        <span className="text-sm">
                          {member.profiles?.display_name || "Unknown"}
                        </span>
                      </div>
                    </button>
                  ))}
                  {filteredGuardians.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-2">
                      {searchQuery ? "No matching parents found" : "No available parents in team"}
                    </p>
                  )}
                </div>
              </ScrollArea>

              {selectedUserId && (
                <div className="space-y-2">
                  <Label className="text-sm">Relationship</Label>
                  <Select value={relationshipType} onValueChange={setRelationshipType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {relationshipTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {!isIcp && !potentialGuardians?.length && !loadingGuardians && (
            <p className="text-sm text-muted-foreground text-center py-2 border-t pt-4">
              Assign this child to a team first to link other parents as guardians.
            </p>
          )}
        </div>

        <ResponsiveDialogFooter className="mt-4">
          {selectedUserId ? (
            <Button
              className="w-full"
              onClick={() => addGuardian.mutate()}
              disabled={addGuardian.isPending}
            >
              {addGuardian.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              <Plus className="h-4 w-4 mr-2" />
              Add Guardian
            </Button>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
