import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import { updateLiveGroup } from "@/live/features/messaging";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  groupId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Name-only rename for competition chats (server checks competition owner/admin). */
export function RenameChatGroupDialog({ groupId, currentName, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= 100 && trimmed !== currentName;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (resolveAuthBackend() === "icp") {
        // ICP: name-only update; the messaging canister enforces that the
        // caller is a competition owner/admin for this conversation.
        await withFeatureBackend("messaging", {
          supabase: async () => {
            throw new Error("Supabase rename is not used in ICP mode");
          },
          icp: (ctx) => updateLiveGroup(ctx, groupId, trimmed),
        }, { conversationId: groupId, writeKey: `rename-chat-${groupId}` });
      } else {
        const { error } = await (supabase.rpc as any)("rename_competition_chat", {
          _group_id: groupId,
          _name: trimmed,
        });
        if (error) throw error;
      }
    } catch (e) {
      setSaving(false);
      toast.error("Couldn't rename chat", {
        description: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    setSaving(false);
    toast.success("Chat renamed");
    queryClient.invalidateQueries({ queryKey: ["group-chat"] });
    queryClient.invalidateQueries({ queryKey: ["chat-group", groupId] });
    queryClient.invalidateQueries({ queryKey: ["chat-groups"] });
    queryClient.invalidateQueries({ queryKey: ["messages-list"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename chat</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!canSave || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
