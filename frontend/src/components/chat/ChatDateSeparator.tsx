import { format, isToday, isYesterday } from "date-fns";

interface ChatDateSeparatorProps {
  date: Date;
}

export function ChatDateSeparator({ date }: ChatDateSeparatorProps) {
  const formatDateLabel = (date: Date): string => {
    if (isToday(date)) {
      return "Today";
    }
    if (isYesterday(date)) {
      return "Yesterday";
    }
    return format(date, "EEEE, d MMMM yyyy");
  };

  return (
    <div className="flex items-center justify-center my-4">
      <div className="bg-muted text-muted-foreground text-xs px-3 py-1 rounded-full">
        {formatDateLabel(date)}
      </div>
    </div>
  );
}
