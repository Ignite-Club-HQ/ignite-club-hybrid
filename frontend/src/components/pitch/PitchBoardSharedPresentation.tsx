import { Flame, Loader2 } from "lucide-react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

export const AutoSubPlanDialog = lazyWithRetry(() => import("./AutoSubPlanDialog"));
export const SubstitutionPreviewDialog = lazyWithRetry(() => import("./SubstitutionPreviewDialog"));
export const BenchToSubDialog = lazyWithRetry(() => import("./BenchToSubDialog"));
export const MatchStatsPanel = lazyWithRetry(() => import("./MatchStatsPanel"));
export const PlayerPositionEditor = lazyWithRetry(() => import("./PlayerPositionEditor"));
export const PositionSwapDialog = lazyWithRetry(() => import("./PositionSwapDialog"));
export const PitchSwapConfirmDialog = lazyWithRetry(() => import("./PitchSwapConfirmDialog"));
export const ManualSubConfirmDialog = lazyWithRetry(() => import("./ManualSubConfirmDialog"));
export const FormationChangeDialog = lazyWithRetry(() => import("./FormationChangeDialog"));
export const PitchPlayerActionMenu = lazyWithRetry(() => import("./PitchPlayerActionMenu"));
export const SubConfirmDialog = lazyWithRetry(() => import("./SubConfirmDialog"));
export const AddFillInPlayerDialog = lazyWithRetry(() => import("./AddFillInPlayerDialog"));
export const AutoSubControlPanel = lazyWithRetry(() => import("./AutoSubControlPanel"));
export const PreGameLineupScreen = lazyWithRetry(() => import("./PreGameLineupScreen"));

export const DialogLoader = () => (
  <div className="flex items-center justify-center p-4">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

export const PitchBoardLoading = ({ message = "Loading..." }: { message?: string }) => (
  <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12 bg-pitch-green min-h-[300px]">
    <div className="flex items-center gap-3">
      <div className="p-3 rounded-xl bg-primary">
        <Flame className="h-8 w-8 text-primary-foreground" />
      </div>
      <span className="text-4xl" role="img" aria-label="soccer ball">⚽</span>
    </div>
    <Loader2 className="h-6 w-6 animate-spin text-white" />
    <p className="text-sm text-white/80">{message}</p>
  </div>
);
