import { Suspense, type ComponentProps } from "react";
import type { MiniLeagueTeams, Player } from "./types";
import type { PitchPosition } from "./PositionBadge";
import {
  AddFillInPlayerDialog,
  BenchToSubDialog,
  PlayerPositionEditor,
  PositionSwapDialog,
  SubstitutionPreviewDialog,
} from "./PitchBoardSharedPresentation";

type PositionEditorUpdate = ComponentProps<typeof PlayerPositionEditor>["onUpdatePositions"];
type PositionSwapHandler = ComponentProps<typeof PositionSwapDialog>["onSwapAndSubstitute"];
type SubstitutionOptionHandler = ComponentProps<typeof SubstitutionPreviewDialog>["onSelectOption"];
type BenchSubstitutionHandler = ComponentProps<typeof BenchToSubDialog>["onSelectOption"];

interface PitchBoardPositionDialogsProps {
  positionEditorOpen: boolean;
  setPositionEditorOpen: (open: boolean) => void;
  players: Player[];
  onUpdatePositions: PositionEditorUpdate;
  positionSwapDialogOpen: boolean;
  setPositionSwapDialogOpen: (open: boolean) => void;
  pendingSubBenchPlayer: string | null;
  playersOnPitch: Player[];
  requiredPosition: PitchPosition | null;
  onSwapAndSubstitute: PositionSwapHandler;
  onClearPositionSwap: () => void;
  miniLeagueTeams?: MiniLeagueTeams;
  subPreviewOpen: boolean;
  setSubPreviewOpen: (open: boolean) => void;
  setSelectedOnPitch: (playerId: string | null) => void;
  setSelectedOnBench: (playerId: string | null) => void;
  setPreviewSwapPlayers: (players: { sourceId: string | null; targetId: string | null }) => void;
  pitchPlayer: Player | null;
  playersOnBench: Player[];
  onSelectSubstitutionOption: SubstitutionOptionHandler;
  benchToSubOpen: boolean;
  setBenchToSubOpen: (open: boolean) => void;
  benchToSubPlayer: string | null;
  setBenchToSubPlayer: (playerId: string | null) => void;
  onSelectBenchSubstitution: BenchSubstitutionHandler;
  onAddFillInPlayer: () => void;
  existingNumbers: number[];
  fillInDialogOpen: boolean;
  setFillInDialogOpen: (open: boolean) => void;
}

export function PitchBoardPositionDialogs({
  positionEditorOpen,
  setPositionEditorOpen,
  players,
  onUpdatePositions,
  positionSwapDialogOpen,
  setPositionSwapDialogOpen,
  pendingSubBenchPlayer,
  playersOnPitch,
  requiredPosition,
  onSwapAndSubstitute,
  onClearPositionSwap,
  miniLeagueTeams,
  subPreviewOpen,
  setSubPreviewOpen,
  setSelectedOnPitch,
  setSelectedOnBench,
  setPreviewSwapPlayers,
  pitchPlayer,
  playersOnBench,
  onSelectSubstitutionOption,
  benchToSubOpen,
  setBenchToSubOpen,
  benchToSubPlayer,
  setBenchToSubPlayer,
  onSelectBenchSubstitution,
  onAddFillInPlayer,
  existingNumbers,
  fillInDialogOpen,
  setFillInDialogOpen,
}: PitchBoardPositionDialogsProps) {
  return (
    <>
      <PlayerPositionEditor
        open={positionEditorOpen}
        onOpenChange={setPositionEditorOpen}
        players={players}
        onUpdatePositions={onUpdatePositions}
      />

      <PositionSwapDialog
        open={positionSwapDialogOpen}
        onOpenChange={setPositionSwapDialogOpen}
        benchPlayer={players.find((player) => player.id === pendingSubBenchPlayer) || null}
        pitchPlayers={playersOnPitch}
        requiredPosition={requiredPosition}
        onSwapAndSubstitute={onSwapAndSubstitute}
        onCancel={onClearPositionSwap}
        miniLeagueTeams={miniLeagueTeams}
      />

      <SubstitutionPreviewDialog
        open={subPreviewOpen}
        onOpenChange={(open) => {
          setSubPreviewOpen(open);
          if (!open) {
            setSelectedOnPitch(null);
            setSelectedOnBench(null);
            setPreviewSwapPlayers({ sourceId: null, targetId: null });
          }
        }}
        pitchPlayer={pitchPlayer}
        benchPlayers={playersOnBench}
        allPitchPlayers={playersOnPitch}
        onSelectOption={onSelectSubstitutionOption}
        miniLeagueTeams={miniLeagueTeams}
      />

      <Suspense fallback={null}>
        <BenchToSubDialog
          open={benchToSubOpen}
          onOpenChange={(open) => {
            setBenchToSubOpen(open);
            if (!open) setBenchToSubPlayer(null);
          }}
          benchPlayer={players.find((player) => player.id === benchToSubPlayer) || null}
          allPitchPlayers={playersOnPitch}
          onSelectOption={onSelectBenchSubstitution}
          miniLeagueTeams={miniLeagueTeams}
        />
      </Suspense>

      <Suspense fallback={null}>
        <AddFillInPlayerDialog
          onAddPlayer={onAddFillInPlayer}
          existingNumbers={existingNumbers}
          hideTrigger
          externalOpen={fillInDialogOpen}
          onExternalOpenChange={setFillInDialogOpen}
        />
      </Suspense>

    </>
  );
}
