import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
    const { error } = await (supabase.rpc as any)("rename_competition_chat", {
      _group_id: groupId,
      _name: trimmed,
    });
    setSaving(false);
    if (error) {
      toast.error("Couldn't rename chat", { description: error.message });
      return;
    }
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
