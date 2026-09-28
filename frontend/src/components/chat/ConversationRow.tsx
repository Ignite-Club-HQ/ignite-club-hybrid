import { memo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, BellOff, ImageIcon, Crown, Lock, EyeOff, Shield } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ConversationAvatar } from "@/components/chat/ConversationAvatar";
import { formatTimeShort } from "@/lib/formatTimeShort";
import { formatMessagePreview as stripMentionFormatting } from "@/lib/messagePreview";
import { isIgniteSupportUser } from "@/lib/systemUser";
import { useAuth } from "@/hooks/useAuth";
import { markChatScopeNotificationsRead } from "@/lib/markChatScopeRead";

// Lazy import to avoid cycle if MessagePreview imports something heavy.
import { MessagePreview } from "@/components/chat/MessagePreview";


export interface UnifiedConversationLike {
  type: 'club' | 'team' | 'group' | 'league' | 'dm' | 'broadcast' | 'support' | 'admin_group';
  id: string;
  key: string;
  name: string;
  avatarUrl?: string | null;
  link: string;
  lastActivity: string;
  lastMessage?: { text: string; author: string; created_at: string; image_url?: string | null; is_announcement?: boolean };
  unreadCount: number;
  isMuted: boolean;
  isLocked?: boolean;
  canManage?: boolean;
  canHide?: boolean;
  dmData?: any;
  draftText?: string;
  category?: string | null;
}

interface Props {
  item: UnifiedConversationLike;
  currentUserId?: string | null;
  typeLabel?: string;
  accentStyle?: React.CSSProperties;
  badgeStyle?: React.CSSProperties;
  eventTitleMap: Map<string, string> | Record<string, string>;
  vaultFolderNameMap: Map<string, string> | Record<string, string>;
  vaultFileNameMap: Map<string, string> | Record<string, string>;
  onHideDM?: (id: string) => void;
  onHideGroup?: (id: string) => void;
}

function ConversationRowImpl({
  item,
  currentUserId,
  typeLabel,
  accentStyle,
  badgeStyle,
  eventTitleMap,
  vaultFolderNameMap,
  vaultFileNameMap,
  onHideDM,
  onHideGroup,
}: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, decrementUnreadCount, refreshUnreadCount } = useAuth();
  const hasUnread = item.unreadCount > 0;
  const finalBadgeStyle = badgeStyle ?? { color: 'hsl(var(--muted-foreground) / 0.7)' };

  // Mark notifications read immediately on row click so the bell + inbox
  // badges clear without waiting for the destination chat page to mount.
  const handleOpen = useCallback(() => {
    if (!user) return;
    let scope: Parameters<typeof markChatScopeNotificationsRead>[0]["scope"] | null = null;
    if (item.type === "broadcast") scope = { kind: "broadcast" };
    else if (item.type === "team") scope = { kind: "team", teamId: item.id };
    else if (item.type === "club") scope = { kind: "club", clubId: item.id };
    else if (item.type === "group" || item.type === "league") scope = { kind: "group", groupId: item.id };
    else if (item.type === "dm") scope = { kind: "dm", conversationId: item.id };
    if (!scope) return;
    markChatScopeNotificationsRead({
      userId: user.id,
      scope,
      queryClient,
      decrementUnreadCount,
      refreshUnreadCount,
    });
  }, [user, item.type, item.id, queryClient, decrementUnreadCount, refreshUnreadCount]);

  if (item.type === 'broadcast') {
    return (
      <Link to={item.link} onClick={handleOpen}>

        <Card className="hover:border-primary/50 transition-colors bg-primary/5">
          <CardContent className="py-[18px] px-3 flex items-center gap-3">
            <div className="shrink-0">
              <ConversationAvatar type="broadcast" name="Announcements" className="h-9 w-9" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-1">
                <h3 className={`truncate text-[15px] leading-tight ${hasUnread ? 'font-bold' : 'font-semibold'}`}>Announcements</h3>
                <div className="flex items-center gap-1.5 shrink-0 min-w-0">
                  {item.lastMessage?.created_at && (
                    <span className="text-[11px] text-muted-foreground">{formatTimeShort(item.lastMessage.created_at)}</span>
                  )}
                  {hasUnread && (
                    <span className="h-[18px] min-w-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                      {item.unreadCount > 9 ? "9+" : item.unreadCount}
                    </span>
                  )}
                </div>
              </div>
              <p className={`text-[0.8125rem] leading-relaxed mt-1 line-clamp-2 ${hasUnread ? 'text-foreground/90' : 'text-muted-foreground'}`}>
                {item.draftText ? (
                  <span className="flex items-center gap-1.5">
                    <span className="font-semibold text-destructive">Draft:</span>
                    <span className="truncate">{stripMentionFormatting(item.draftText)}</span>
                  </span>
                ) : (
                  <MessagePreview
                    text={item.lastMessage?.text}
                    imageUrl={item.lastMessage?.image_url}
                    author={item.lastMessage?.author}
                    hasUnread={hasUnread}
                    fallback="Official announcements and updates"
                    eventTitles={eventTitleMap as any}
                    vaultFolderNames={vaultFolderNameMap as any}
                    vaultFileNames={vaultFileNameMap as any}
                  />
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  if (item.type === 'support') {
    return (
      <Link to={item.link} onClick={handleOpen}>
        <Card className="hover:border-primary/50 transition-colors" style={accentStyle}>
          <CardContent className="py-[18px] px-3 flex items-center gap-3">
            <ConversationAvatar type="support" name="Ignite Support" className="h-9 w-9" />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-1">
                <h3 className="truncate text-[15px] leading-tight font-semibold">Ignite Support</h3>
                <div className="flex items-center gap-0.5 shrink-0">
                  {item.lastMessage?.created_at && (
                    <span className="text-xs text-muted-foreground">{formatTimeShort(item.lastMessage.created_at)}</span>
                  )}
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </div>
              <p className="text-[0.8125rem] leading-relaxed mt-1 line-clamp-2 text-foreground/70">
                {item.lastMessage?.text || "Welcome message"}
              </p>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  if ((item.type === 'club' || item.type === 'group') && item.isLocked) {
    const lockSubtitle =
      item.type === 'club'
        ? 'Club Pro required for club-wide chat'
        : 'Club Pro required for this group';
    return (
      <Link to={item.link} onClick={handleOpen}>
        <Card className="opacity-70 hover:border-primary/50 transition-colors">
          <CardContent className="py-3 px-2.5 flex items-center gap-2">
            <div className="relative">
              <Avatar className="h-10 w-10 grayscale">
                <AvatarImage src={item.avatarUrl || undefined} />
                <AvatarFallback className="bg-secondary text-secondary-foreground text-sm">
                  {item.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-muted flex items-center justify-center border-2 border-background">
                <Lock className="h-2.5 w-2.5 text-muted-foreground" />
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-semibold text-muted-foreground text-sm">{item.name}</h3>
                <Badge variant="secondary" className="gap-1 text-[10px] shrink-0 px-1.5 py-0">
                  <Crown className="h-2.5 w-2.5" />
                  Pro
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {lockSubtitle}
              </p>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </CardContent>
        </Card>
      </Link>
    );
  }


  if (item.type === 'dm') {
    const conv = item.dmData;
    const isOwn = conv?.last_message?.author_id === currentUserId;
    const isSupport = isIgniteSupportUser(conv?.other_user?.id);

    const dmCard = (
      <Link to={item.link} onClick={handleOpen}>
        <Card className="hover:border-primary/50 transition-colors">
          <CardContent className="py-[18px] px-3 flex items-center gap-3">
            <div className="shrink-0">
              {isSupport ? (
                <ConversationAvatar type="support" name="Ignite Support" className="h-9 w-9" />
              ) : (
                <ConversationAvatar type="dm" name={item.name} avatarUrl={conv?.other_user?.avatar_url} className="h-9 w-9" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <h3 className={`truncate text-[15px] leading-tight ${hasUnread ? 'font-bold' : 'font-semibold'}`}>
                    {item.name}
                  </h3>
                  {typeLabel && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-normal shrink-0" style={finalBadgeStyle}>
                      {typeLabel}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0 min-w-0">
                  {item.lastMessage?.created_at && (
                    <span className="text-[11px] text-muted-foreground">{formatTimeShort(item.lastMessage.created_at)}</span>
                  )}
                  {hasUnread && (
                    <span className="h-[18px] min-w-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                      {item.unreadCount > 9 ? "9+" : item.unreadCount}
                    </span>
                  )}
                </div>
              </div>
              <p className={`text-[0.8125rem] leading-relaxed mt-1 line-clamp-2 ${hasUnread ? 'text-foreground/90' : 'text-muted-foreground'}`}>
                {item.draftText ? (
                  <span className="flex items-center gap-1.5">
                    <span className="font-semibold text-destructive">Draft:</span>
                    <span className="truncate">{stripMentionFormatting(item.draftText)}</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    {isOwn && <span className="text-muted-foreground">You:</span>}
                    {conv?.last_message?.image_url && <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span className="truncate">
                      {conv?.last_message?.text ? stripMentionFormatting(conv.last_message.text, eventTitleMap as any) :
                       conv?.last_message?.image_url ? "Image" : "Start a conversation"}
                    </span>
                  </span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      </Link>
    );

    if (!item.canHide || !onHideDM) return dmCard;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{dmCard}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onHideDM(item.id)}>
            <EyeOff className="h-4 w-4 mr-2" />
            Hide conversation
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  if (item.type === 'admin_group') {
    return (
      <Card
        className="hover:border-primary/50 transition-colors cursor-pointer"
        style={accentStyle}
        onClick={() => { handleOpen(); navigate(item.link); }}
        tabIndex={0}
        role="link"
      >
        <CardContent className="py-[18px] px-3 flex items-center gap-3">
          <div className="relative shrink-0">
            <ConversationAvatar type="dm" name={item.name} avatarUrl={item.avatarUrl} className="h-9 w-9" />
            <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center border-2 border-background">
              <Shield className="h-2.5 w-2.5 text-primary-foreground" />
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <h3 className={`truncate text-[15px] leading-tight ${hasUnread ? 'font-bold' : 'font-semibold'}`}>{item.name}</h3>
                {typeLabel && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-normal shrink-0" style={finalBadgeStyle}>
                    {typeLabel}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {item.lastMessage?.created_at && (
                  <span className="text-xs text-muted-foreground">{formatTimeShort(item.lastMessage.created_at)}</span>
                )}
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </div>
            <p className="text-[0.8125rem] leading-relaxed mt-1 line-clamp-2 text-muted-foreground">
              <MessagePreview
                text={item.lastMessage?.text}
                imageUrl={item.lastMessage?.image_url}
                author={item.lastMessage?.author}
                hasUnread={hasUnread}
                fallback="Admin chat"
                eventTitles={eventTitleMap as any}
                vaultFolderNames={vaultFolderNameMap as any}
                vaultFileNames={vaultFileNameMap as any}
              />
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (item.type === 'group' || item.type === 'league') {
    const groupCard = (
      <Card
        className="hover:border-primary/50 transition-colors cursor-pointer"
        style={accentStyle}
        onClick={() => { handleOpen(); navigate(item.link); }}
        tabIndex={0}
        role="link"
      >
        <CardContent className="py-[18px] px-3 flex items-center gap-3">
          <div className="shrink-0">
            <ConversationAvatar type={item.type} name={item.name} avatarUrl={item.avatarUrl} category={item.category} className="h-9 w-9" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <h3 className={`truncate text-[15px] leading-tight ${hasUnread ? 'font-bold' : 'font-semibold'}`}>{item.name}</h3>
                {item.isMuted && <BellOff className="h-3 w-3 text-muted-foreground shrink-0" />}
                {typeLabel && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-normal shrink-0" style={finalBadgeStyle}>
                    {typeLabel}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0 min-w-0">
                {item.lastMessage?.created_at && (
                  <span className="text-[11px] text-muted-foreground">{formatTimeShort(item.lastMessage.created_at)}</span>
                )}
                {hasUnread && (
                  <span className="h-[18px] min-w-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                    {item.unreadCount > 9 ? "9+" : item.unreadCount}
                  </span>
                )}
              </div>
            </div>
            <p className={`text-[0.8125rem] leading-relaxed mt-1 line-clamp-2 ${hasUnread ? 'text-foreground/90' : 'text-muted-foreground'}`}>
              {item.draftText ? (
                <span className="flex items-center gap-1.5">
                  <span className="font-semibold text-destructive">Draft:</span>
                  <span className="truncate">{stripMentionFormatting(item.draftText)}</span>
                </span>
              ) : (
                <MessagePreview
                  text={item.lastMessage?.text}
                  imageUrl={item.lastMessage?.image_url}
                  author={item.lastMessage?.author}
                  hasUnread={hasUnread}
                  fallback="No messages yet"
                  eventTitles={eventTitleMap as any}
                  vaultFolderNames={vaultFolderNameMap as any}
                  vaultFileNames={vaultFileNameMap as any}
                />
              )}
            </p>
          </div>
        </CardContent>
      </Card>
    );

    if (!item.canHide || !onHideGroup) return groupCard;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{groupCard}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onHideGroup(item.id)}>
            <EyeOff className="h-4 w-4 mr-2" />
            Hide group
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  // Club / Team default
  return (
    <Link to={item.link} onClick={handleOpen}>
      <Card className="hover:border-primary/50 transition-colors" style={accentStyle}>
        <CardContent className="py-[18px] px-3 flex items-center gap-3">
          <div className="shrink-0">
            <ConversationAvatar type={item.type} name={item.name} avatarUrl={item.avatarUrl} className="h-9 w-9" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <h3 className={`truncate text-[15px] leading-tight ${hasUnread ? 'font-bold' : 'font-semibold'}`}>{item.name}</h3>
                {item.isMuted && <BellOff className="h-3 w-3 text-muted-foreground shrink-0" />}
                {typeLabel && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-normal shrink-0" style={finalBadgeStyle}>
                    {typeLabel}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0 min-w-0">
                {item.lastMessage?.created_at && (
                  <span className="text-[11px] text-muted-foreground">{formatTimeShort(item.lastMessage.created_at)}</span>
                )}
                {hasUnread && (
                  <span className="h-[18px] min-w-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                    {item.unreadCount > 9 ? "9+" : item.unreadCount}
                  </span>
                )}
              </div>
            </div>
            <p className={`text-[0.8125rem] leading-relaxed mt-1 line-clamp-2 ${hasUnread ? 'text-foreground/90' : 'text-muted-foreground'}`}>
              {item.draftText ? (
                <span className="flex items-center gap-1.5">
                  <span className="font-semibold text-destructive">Draft:</span>
                  <span className="truncate">{stripMentionFormatting(item.draftText)}</span>
                </span>
              ) : (
                <MessagePreview
                  text={item.lastMessage?.text}
                  imageUrl={item.lastMessage?.image_url}
                  author={item.lastMessage?.author}
                  hasUnread={hasUnread}
                  fallback={item.type === 'club' ? "Club-wide announcements" : "No messages yet"}
                  isAnnouncement={(item.lastMessage as any)?.is_announcement}
                  eventTitles={eventTitleMap as any}
                  vaultFolderNames={vaultFolderNameMap as any}
                  vaultFileNames={vaultFileNameMap as any}
                />
              )}
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * Memoized conversation row for the Messages inbox.
 *
 * Comparison is shallow on the props that actually affect render. Maps
 * (eventTitleMap, vaultFolderNameMap, vaultFileNameMap) are reference-compared
 * — they come from React Query and stay identity-stable until a refetch, so
 * comparing by reference is correct and cheap. The `item` is compared
 * field-by-field on the render-affecting subset; identity comparison alone
 * would miss in-place updates (unreadCount, lastMessage) that arrive when the
 * parent rebuilds the unified list with a new array of new objects.
 */
export const ConversationRow = memo(ConversationRowImpl, (a, b) => {
  if (a === b) return true;
  if (a.eventTitleMap !== b.eventTitleMap) return false;
  if (a.vaultFolderNameMap !== b.vaultFolderNameMap) return false;
  if (a.vaultFileNameMap !== b.vaultFileNameMap) return false;
  if (a.currentUserId !== b.currentUserId) return false;
  if (a.typeLabel !== b.typeLabel) return false;
  if (a.onHideDM !== b.onHideDM) return false;
  if (a.onHideGroup !== b.onHideGroup) return false;
  // Style objects are recreated each render in the parent — compare by value.
  const styleEq = (x?: React.CSSProperties, y?: React.CSSProperties) => {
    if (x === y) return true;
    if (!x || !y) return false;
    const xk = Object.keys(x); const yk = Object.keys(y);
    if (xk.length !== yk.length) return false;
    for (const k of xk) if ((x as any)[k] !== (y as any)[k]) return false;
    return true;
  };
  if (!styleEq(a.accentStyle, b.accentStyle)) return false;
  if (!styleEq(a.badgeStyle, b.badgeStyle)) return false;

  const ai = a.item, bi = b.item;
  if (ai === bi) return true;
  if (
    ai.key !== bi.key ||
    ai.type !== bi.type ||
    ai.id !== bi.id ||
    ai.name !== bi.name ||
    ai.avatarUrl !== bi.avatarUrl ||
    ai.link !== bi.link ||
    ai.unreadCount !== bi.unreadCount ||
    ai.isMuted !== bi.isMuted ||
    ai.isLocked !== bi.isLocked ||
    ai.canHide !== bi.canHide ||
    ai.draftText !== bi.draftText ||
    ai.category !== bi.category ||
    ai.lastActivity !== bi.lastActivity
  ) return false;
  const al = ai.lastMessage, bl = bi.lastMessage;
  if (al !== bl) {
    if (!al || !bl) return false;
    if (
      al.text !== bl.text ||
      al.author !== bl.author ||
      al.created_at !== bl.created_at ||
      al.image_url !== bl.image_url ||
      al.is_announcement !== bl.is_announcement
    ) return false;
  }
  // dmData: compare only the fields the row reads.
  if (ai.dmData !== bi.dmData) {
    const ad = ai.dmData?.last_message, bd = bi.dmData?.last_message;
    if (
      ai.dmData?.other_user?.id !== bi.dmData?.other_user?.id ||
      ai.dmData?.other_user?.avatar_url !== bi.dmData?.other_user?.avatar_url ||
      ad?.author_id !== bd?.author_id ||
      ad?.text !== bd?.text ||
      ad?.image_url !== bd?.image_url
    ) return false;
  }
  return true;
});
