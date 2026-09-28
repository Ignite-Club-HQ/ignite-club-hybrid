import {
  Bell,
  MessageSquare,
  Image,
  Calendar,
  Heart,
  Reply,
  UserPlus,
  UserMinus,
  CheckCircle,
  XCircle,
  Megaphone,
  Users,
  ClipboardList,
  AtSign,
  AlertTriangle,
  AlertCircle,
  HardDrive,
  Info,
  type LucideIcon
} from "lucide-react";
import {
  getNotificationIconConfig,
  extractReactionEmoji,
  REACTION_NOTIFICATION_TYPES,
} from "@/lib/notificationTypes";
import { cn } from "@/lib/utils";

// Icon name to component mapping
const ICON_MAP: Record<string, LucideIcon> = {
  Bell,
  MessageSquare,
  Image,
  Calendar,
  Heart,
  Reply,
  UserPlus,
  UserMinus,
  CheckCircle,
  XCircle,
  Megaphone,
  Users,
  ClipboardList,
  AtSign,
  AlertTriangle,
  AlertCircle,
  HardDrive,
  Info,
};

export interface NotificationIconProps {
  /** The notification type to display an icon for */
  type: string;
  /** Render mode: 'icon' for Lucide icons, 'emoji' for emoji characters */
  mode?: 'icon' | 'emoji';
  /** Size of the icon (only applies to 'icon' mode) */
  size?: number;
  /** Additional CSS classes */
  className?: string;
  /** Whether to include the color class from config */
  withColor?: boolean;
  /**
   * Optional notification message. When provided for reaction notification
   * types, the actual reaction emoji (👍, 🎉, 😂, …) is rendered instead of
   * the generic Heart icon so the icon matches the reaction that was made.
   */
  message?: string | null;
}

/**
 * A reusable component that renders notification icons consistently across the app.
 * Supports both Lucide icons and emoji rendering based on context.
 */
export function NotificationIcon({
  type,
  mode = 'icon',
  size = 16,
  className,
  withColor = true,
  message,
}: NotificationIconProps) {
  const config = getNotificationIconConfig(type);

  // For reaction notifications, prefer the actual reaction emoji so the
  // icon matches the reaction (👍 shows a thumbs-up, 🎉 a party popper, …).
  const reactionEmoji = REACTION_NOTIFICATION_TYPES.has(type)
    ? extractReactionEmoji(message)
    : null;

  if (mode === 'emoji' || reactionEmoji) {
    const glyph = reactionEmoji ?? config.emoji;
    return (
      <span
        className={cn("text-xl leading-none", className)}
        role="img"
        aria-label={type.replace(/_/g, ' ')}
      >
        {glyph}
      </span>
    );
  }

  const IconComponent = ICON_MAP[config.iconName] || Bell;
  
  return (
    <IconComponent
      size={size}
      className={cn(
        withColor && config.colorClass,
        className
      )}
    />
  );
}

/**
 * Hook to get notification icon data for custom rendering
 */
export function useNotificationIcon(type: string, message?: string | null) {
  const config = getNotificationIconConfig(type);
  const IconComponent = ICON_MAP[config.iconName] || Bell;
  const reactionEmoji = REACTION_NOTIFICATION_TYPES.has(type)
    ? extractReactionEmoji(message)
    : null;

  return {
    Icon: IconComponent,
    emoji: reactionEmoji ?? config.emoji,
    reactionEmoji,
    colorClass: config.colorClass,
    iconName: config.iconName,
  };
}
