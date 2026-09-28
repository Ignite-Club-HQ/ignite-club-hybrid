import { memo, useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import type { ReaderInfo } from "@/hooks/useMessageReads";

type MessageType = "team" | "club" | "broadcast" | "group" | "dm" | "club_admin";

const MESSAGE_ID_FIELDS: Record<MessageType, string> = {
  team: "team_message_id",
  club: "club_message_id",
  group: "group_message_id",
  broadcast: "broadcast_message_id",
  dm: "direct_message_id",
  club_admin: "club_admin_message_id",
};

interface ReadReceiptSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readers: ReaderInfo[];
  messageId: string;
  messageType: MessageType;
  contextId: string;
  currentUserId?: string;
}

interface MemberInfo {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export const ReadReceiptSheet = memo(function ReadReceiptSheet({
  open,
  onOpenChange,
  readers: propReaders,
  messageId,
  messageType,
  contextId,
  currentUserId,
}: ReadReceiptSheetProps) {
  const [allMembers, setAllMembers] = useState<MemberInfo[]>([]);
  const [fetchedReaders, setFetchedReaders] = useState<ReaderInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // Use prop readers if available, otherwise use fetched readers
  const readers = propReaders.length > 0 ? propReaders : fetchedReaders;

  useEffect(() => {
    if (!open || !messageId) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const field = MESSAGE_ID_FIELDS[messageType];

        // Kick off all independent queries in parallel
        const readsPromise = (supabase
          .from("message_reads")
          .select(`${field}, user_id`) as any)
          .eq(field, messageId);

        const needsMembers =
          messageType !== "dm" && messageType !== "broadcast" && !!contextId;

        let membersPromise: Promise<string[]> = Promise.resolve([]);
        if (needsMembers) {
          if (messageType === "team") {
            membersPromise = Promise.resolve(
              supabase.from("user_roles").select("user_id").eq("team_id", contextId)
            ).then(({ data }) => [...new Set((data || []).map((r: any) => r.user_id))]);
          } else if (messageType === "club") {
            membersPromise = Promise.resolve(
              supabase.from("user_roles").select("user_id").eq("club_id", contextId)
            ).then(({ data }) => [...new Set((data || []).map((r: any) => r.user_id))]);
          } else if (messageType === "group") {
            membersPromise = (async () => {
              const memberIds = new Set<string>();
              const [gmRes, giRes] = await Promise.all([
                Promise.resolve(supabase.from("group_members").select("user_id").eq("group_id", contextId)),
                Promise.resolve(
                  supabase
                    .from("chat_groups")
                    .select("club_id, team_id, allowed_roles")
                    .eq("id", contextId)
                    .maybeSingle()
                ),
              ]);

              for (const r of gmRes.data || []) memberIds.add((r as any).user_id);
              const groupInfo = giRes.data as any;
              const roleQueries: Promise<any>[] = [];
              if (groupInfo?.club_id && groupInfo?.allowed_roles?.length) {
                roleQueries.push(
                  Promise.resolve(
                    supabase
                      .from("user_roles")
                      .select("user_id")
                      .eq("club_id", groupInfo.club_id)
                      .in("role", groupInfo.allowed_roles)
                  )
                );
              }
              if (groupInfo?.team_id && groupInfo?.allowed_roles?.length) {
                roleQueries.push(
                  Promise.resolve(
                    supabase
                      .from("user_roles")
                      .select("user_id")
                      .eq("team_id", groupInfo.team_id)
                      .in("role", groupInfo.allowed_roles)
                  )
                );
              }

              const roleResults = await Promise.all(roleQueries);
              for (const res of roleResults) {
                for (const r of res.data || []) memberIds.add((r as any).user_id);
              }
              return [...memberIds];
            })();
          }
        }

        const [readsRes, memberIdsRaw] = await Promise.all([readsPromise, membersPromise]);

        const readerUserIds = new Set<string>();
        for (const row of (readsRes as any).data || []) {
          const userId = (row as any).user_id as string;
          if (userId !== currentUserId) readerUserIds.add(userId);
        }

        const memberIds = memberIdsRaw.filter((id) => id !== currentUserId);

        // Single profile fetch for both readers and members
        const allIds = new Set<string>([...readerUserIds, ...memberIds]);
        let profileMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();
        if (allIds.size > 0) {
          const { data: profiles } = await selectCachedProfilesByIds(Array.from(allIds));
          for (const p of profiles || []) {
            profileMap.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url });
          }
        }

        setFetchedReaders(
          Array.from(readerUserIds).map((id) => ({
            user_id: id,
            display_name: profileMap.get(id)?.display_name ?? null,
            avatar_url: profileMap.get(id)?.avatar_url ?? null,
          }))
        );

        if (needsMembers) {
          setAllMembers(
            memberIds.map((id) => ({
              user_id: id,
              display_name: profileMap.get(id)?.display_name ?? null,
              avatar_url: profileMap.get(id)?.avatar_url ?? null,
            }))
          );
        }
      } catch (err) {
        console.error("Error fetching read receipt data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [open, messageId, contextId, messageType, currentUserId]);


  const readerIds = new Set(readers.map((r) => r.user_id));
  const isDm = messageType === "dm";

  const readMembers = isDm
    ? readers
    : allMembers.length > 0
      ? allMembers.filter((m) => readerIds.has(m.user_id))
      : readers;

  const unreadMembers = isDm || allMembers.length === 0
    ? []
    : allMembers.filter((m) => !readerIds.has(m.user_id));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[70vh] rounded-t-2xl">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base">Message Read By</SheetTitle>
        </SheetHeader>

        <div className="overflow-y-auto max-h-[55vh] space-y-4">
          {loading && (
            <p className="text-xs text-muted-foreground text-center py-4">Loading...</p>
          )}

          {!loading && (
            <>
              {/* Read section */}
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                  <Eye className="h-3.5 w-3.5" />
                  <span>Read ({readMembers.length})</span>
                </div>
                {readMembers.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-5">No one has read this yet</p>
                ) : (
                  <div className="space-y-1.5">
                    {readMembers.map((member) => (
                      <MemberRow
                        key={member.user_id}
                        name={member.display_name}
                        avatarUrl={member.avatar_url}
                        isRead
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Unread section */}
              {unreadMembers.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                    <EyeOff className="h-3.5 w-3.5" />
                    <span>Not yet read ({unreadMembers.length})</span>
                  </div>
                  <div className="space-y-1.5">
                    {unreadMembers.map((member) => (
                      <MemberRow
                        key={member.user_id}
                        name={member.display_name}
                        avatarUrl={member.avatar_url}
                        isRead={false}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
});

function MemberRow({
  name,
  avatarUrl,
  isRead,
}: {
  name: string | null;
  avatarUrl: string | null;
  isRead: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1 px-1">
      <Avatar className="h-7 w-7">
        <AvatarImage src={avatarUrl || undefined} />
        <AvatarFallback className="text-[11px] bg-muted text-muted-foreground">
          {(name || "?").charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm flex-1 truncate">{name || "Unknown"}</span>
      {isRead && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
    </div>
  );
}
