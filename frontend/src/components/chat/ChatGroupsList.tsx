import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface ChatGroup {
  id: string;
  name: string;
  club_id: string | null;
  team_id: string | null;
  allowed_roles: string[];
  created_by: string;
  created_at: string;
}

interface ChatGroupsListProps {
  clubId?: string;
  teamId?: string;
  canManage?: boolean;
}

export default function ChatGroupsList({ clubId, teamId, canManage = false }: ChatGroupsListProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["chat-groups", { clubId, teamId }],
    queryFn: async () => {
      let query = supabase.from("chat_groups").select("*");
      
      if (teamId) {
        query = query.eq("team_id", teamId);
      } else if (clubId) {
        query = query.eq("club_id", clubId);
      }
      
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return data as ChatGroup[];
    },
    enabled: !!clubId || !!teamId,
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      // Soft-delete so app admins can restore if the removal was a mistake.
      const { error } = await supabase
        .from("chat_groups")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user?.id ?? null,
        } as any)
        .eq("id", groupId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Chat removed. An app admin can restore it if needed.");
      queryClient.invalidateQueries({ queryKey: ["chat-groups"] });
    },
    onError: () => {
      toast.error("Failed to delete chat group");
    },
  });

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading groups...</p>;
  }

  if (groups.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No chat groups yet. {canManage && "Create one to start!"}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <Card
          key={group.id}
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => navigate(`/groups/${group.id}`)}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="p-2 bg-primary/10 rounded-full shrink-0">
                  <MessageCircle className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate">{group.name}</h3>
                </div>
              </div>
              {canManage && (user?.id === group.created_by || canManage) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-destructive hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Delete this chat group?")) {
                      deleteGroupMutation.mutate(group.id);
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
