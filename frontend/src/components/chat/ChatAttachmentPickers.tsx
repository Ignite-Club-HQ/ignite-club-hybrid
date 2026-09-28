import { Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

const EventPickerSheet = lazyWithRetry(() =>
  import("@/components/chat/EventPickerSheet").then((module) => ({
    default: module.EventPickerSheet,
  })),
);
const NewsPickerSheet = lazyWithRetry(() =>
  import("@/components/chat/NewsPickerSheet").then((module) => ({
    default: module.NewsPickerSheet,
  })),
);
const BoardPickerSheet = lazyWithRetry(() =>
  import("@/components/chat/BoardPickerSheet").then((module) => ({
    default: module.BoardPickerSheet,
  })),
);

interface ChatAttachmentPickersProps {
  eventPickerOpen: boolean;
  onEventPickerOpenChange: (open: boolean) => void;
  onSelectEvent: (eventId: string) => void;
  newsPickerOpen: boolean;
  onNewsPickerOpenChange: (open: boolean) => void;
  onSelectNews: (newsId: string) => void;
  boardPickerOpen: boolean;
  onBoardPickerOpenChange: (open: boolean) => void;
  onSelectBoard: (gameId: string) => void;
  teamId?: string;
  clubId?: string | null;
  miniLeagueId?: string | null;
  competitionId?: string | null;
}

export function ChatAttachmentPickers({
  eventPickerOpen,
  onEventPickerOpenChange,
  onSelectEvent,
  newsPickerOpen,
  onNewsPickerOpenChange,
  onSelectNews,
  boardPickerOpen,
  onBoardPickerOpenChange,
  onSelectBoard,
  teamId,
  clubId,
  miniLeagueId,
  competitionId,
}: ChatAttachmentPickersProps) {
  return (
    <>
      {eventPickerOpen && (
        <Suspense fallback={null}>
          <EventPickerSheet
            open={eventPickerOpen}
            onOpenChange={onEventPickerOpenChange}
            onSelectEvent={onSelectEvent}
            teamId={teamId}
            clubId={clubId}
            miniLeagueId={miniLeagueId}
            competitionId={competitionId}
          />
        </Suspense>
      )}
      {newsPickerOpen && (
        <Suspense fallback={null}>
          <NewsPickerSheet
            open={newsPickerOpen}
            onOpenChange={onNewsPickerOpenChange}
            clubId={clubId}
            onSelectNews={onSelectNews}
          />
        </Suspense>
      )}
      {boardPickerOpen && (
        <Suspense fallback={null}>
          <BoardPickerSheet
            open={boardPickerOpen}
            onOpenChange={onBoardPickerOpenChange}
            onSelectBoard={onSelectBoard}
          />
        </Suspense>
      )}
    </>
  );
}
