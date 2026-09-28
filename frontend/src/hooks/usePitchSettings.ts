/**
 * usePitchSettings — centralizes pitch board settings persistence to Supabase.
 *
 * Replaces 7+ individual `supabase.upsert()` handlers with a single
 * `persistSetting()` helper that always sends the full settings payload,
 * preventing partial-field overwrite bugs on conflict.
 */

import { useState, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TeamSize, FORMATIONS } from "@/components/pitch/types";

export interface PitchSettingsState {
  rotationSpeed: number;
  disablePositionSwaps: boolean;
  disableBatchSubs: boolean;
  rotateGkAtHalftime: boolean;
  minutesPerHalf: number;
  teamSize: TeamSize;
  selectedFormation: number;
  showMatchHeader: boolean;
  showLineupPickerSetting: boolean;
  /** Max acceptable playing-time spread in minutes between most & least played
   *  outfielders. Planner keeps queue (FIFO) order while projected spread is
   *  within this cap; once projected to exceed it, fairness overrides queue. */
  maxSpreadMinutes: number;
}

interface UsePitchSettingsOptions {
  teamId: string;
  readOnly: boolean;
  /** Ref to current settings — avoids stale closures */
  settingsRef: React.MutableRefObject<PitchSettingsState>;
}

/**
 * Build the full upsert payload from current settings, with optional overrides.
 */
const buildPayload = (
  teamId: string,
  settings: PitchSettingsState,
  overrides?: Record<string, unknown>
) => ({
  team_id: teamId,
  rotation_speed: settings.rotationSpeed,
  disable_position_swaps: settings.disablePositionSwaps,
  disable_batch_subs: settings.disableBatchSubs,
  rotate_gk_at_halftime: settings.rotateGkAtHalftime,
  minutes_per_half: settings.minutesPerHalf,
  max_spread_minutes: settings.maxSpreadMinutes,
  team_size: parseInt(settings.teamSize),
  formation: FORMATIONS[settings.teamSize][settings.selectedFormation]?.name || null,
  ...overrides,
});

export function usePitchSettings({ teamId, readOnly, settingsRef }: UsePitchSettingsOptions) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  /** Ref to saved team defaults (used for reset) */
  const savedTeamDefaultsRef = useRef<{
    minutesPerHalf: number;
    rotationSpeed: number;
    disablePositionSwaps: boolean;
    disableBatchSubs: boolean;
    rotateGkAtHalftime: boolean;
    maxSpreadMinutes: number;
    teamSize: TeamSize;
    formation: string | null;
  }>({
    minutesPerHalf: settingsRef.current.minutesPerHalf,
    rotationSpeed: settingsRef.current.rotationSpeed,
    disablePositionSwaps: settingsRef.current.disablePositionSwaps,
    disableBatchSubs: settingsRef.current.disableBatchSubs,
    rotateGkAtHalftime: settingsRef.current.rotateGkAtHalftime,
    maxSpreadMinutes: settingsRef.current.maxSpreadMinutes,
    teamSize: settingsRef.current.teamSize,
    formation: null,
  });

  /**
   * Persist a single setting change to DB.
   * Reads current values from settingsRef to always send the full payload.
   */
  const persistSetting = useCallback(
    async (overrides?: Record<string, unknown>) => {
      if (readOnly) return;
      try {
        const { error } = await supabase
          .from("team_subscriptions")
          .upsert(buildPayload(teamId, settingsRef.current, overrides), {
            onConflict: "team_id",
          });
        if (error) throw error;

        // Invalidate cached subscription queries so the next PitchBoard mount
        // (or parent re-read) sees the new value instead of reverting to a
        // stale cached default (e.g. minutes_per_half snapping back to 10).
        queryClient.invalidateQueries({ queryKey: ["team-subscription", teamId] });
        queryClient.invalidateQueries({ queryKey: ["team-subscription-for-pitch", teamId] });
      } catch (e) {
        console.error("Failed to persist setting:", e);
      }
    },
    [teamId, readOnly, settingsRef, queryClient]
  );

  /** Persist team size (with optional formation name override). */
  const persistTeamSizeToDb = useCallback(
    async (newSize: TeamSize, formationName?: string) => {
      await persistSetting({
        team_size: parseInt(newSize),
        formation: formationName || FORMATIONS[newSize][0]?.name || null,
      });
    },
    [persistSetting]
  );

  /** Persist formation name. */
  const persistFormationToDb = useCallback(
    async (formationName: string) => {
      await persistSetting({ formation: formationName });
    },
    [persistSetting]
  );

  /** Persist rotation speed. */
  const persistRotationSpeed = useCallback(
    async (speed: number) => {
      await persistSetting({ rotation_speed: speed });
    },
    [persistSetting]
  );

  /** Persist disable position swaps. */
  const persistDisablePositionSwaps = useCallback(
    async (disabled: boolean) => {
      await persistSetting({ disable_position_swaps: disabled });
    },
    [persistSetting]
  );

  /** Persist disable batch subs. */
  const persistDisableBatchSubs = useCallback(
    async (disabled: boolean) => {
      await persistSetting({ disable_batch_subs: disabled });
    },
    [persistSetting]
  );

  /** Persist rotate GK at halftime. */
  const persistRotateGkAtHalftime = useCallback(
    async (enabled: boolean) => {
      await persistSetting({ rotate_gk_at_halftime: enabled });
    },
    [persistSetting]
  );

  /** Persist minutes per half. */
  const persistMinutesPerHalf = useCallback(
    async (minutes: number) => {
      await persistSetting({ minutes_per_half: minutes });
    },
    [persistSetting]
  );

  /** Persist max playing-time spread (minutes). */
  const persistMaxSpreadMinutes = useCallback(
    async (minutes: number) => {
      await persistSetting({ max_spread_minutes: minutes });
    },
    [persistSetting]
  );

  /** Persist show lineup picker setting. */
  const persistShowLineupPicker = useCallback(
    async (enabled: boolean) => {
      await persistSetting({ show_lineup_picker: enabled });
    },
    [persistSetting]
  );

  /** Save all settings at once (used by settings dialog save button). */
  const handleSaveSettings = useCallback(async () => {
    if (readOnly) return;

    setIsSavingSettings(true);
    try {
      const settings = settingsRef.current;
      const { error } = await supabase
        .from("team_subscriptions")
        .upsert(
          {
            ...buildPayload(teamId, settings),
            show_match_header: settings.showMatchHeader,
            show_lineup_picker: settings.showLineupPickerSetting,
          },
          { onConflict: "team_id" }
        );

      if (error) throw error;

      savedTeamDefaultsRef.current = {
        minutesPerHalf: settings.minutesPerHalf,
        rotationSpeed: settings.rotationSpeed,
        disablePositionSwaps: settings.disablePositionSwaps,
        disableBatchSubs: settings.disableBatchSubs,
        rotateGkAtHalftime: settings.rotateGkAtHalftime,
        maxSpreadMinutes: settings.maxSpreadMinutes,
        teamSize: settings.teamSize,
        formation:
          FORMATIONS[settings.teamSize][settings.selectedFormation]?.name || null,
      };

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["team-subscription", teamId] }),
        queryClient.invalidateQueries({ queryKey: ["team-subscription-for-pitch", teamId] }),
      ]);

      toast({
        title: "Settings saved",
        description: "Your pitch settings have been saved successfully.",
      });
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast({
        title: "Failed to save",
        description: "Could not save your settings. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingSettings(false);
    }
  }, [teamId, readOnly, settingsRef, queryClient, toast]);

  return {
    isSavingSettings,
    savedTeamDefaultsRef,
    persistSetting,
    persistTeamSizeToDb,
    persistFormationToDb,
    persistRotationSpeed,
    persistDisablePositionSwaps,
    persistDisableBatchSubs,
    persistRotateGkAtHalftime,
    persistMinutesPerHalf,
    persistMaxSpreadMinutes,
    persistShowLineupPicker,
    handleSaveSettings,
  };
}
