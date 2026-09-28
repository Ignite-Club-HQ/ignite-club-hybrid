import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────
// ADMOB KILL SWITCH — set to true to re-enable
// ──────────────────────────────────────────────
const ADMOB_ENABLED = false;

const loadOptionalNativeModule = (specifier: string) =>
  new Function("moduleName", "return import(moduleName)")(specifier) as Promise<any>;

interface AdMobConfig {
  platform: string;
  app_id: string;
  banner_ad_unit_id: string;
  interstitial_ad_unit_id: string;
  is_enabled: boolean;
}

const isNative = () => !!(window as any).Capacitor;

const getPlatform = (): "android" | "ios" | null => {
  const cap = (window as any).Capacitor;
  if (!cap) return null;
  const platform = cap.getPlatform?.();
  if (platform === "android") return "android";
  if (platform === "ios") return "ios";
  return null;
};

export function useAdMobConfig() {
  return useQuery({
    queryKey: ["admob-config-native"],
    queryFn: async () => {
      const platform = getPlatform();
      if (!platform) return null;

      const { data, error } = await supabase
        .from("admob_config")
        .select("*")
        .eq("platform", platform)
        .single();

      if (error) return null;
      return data as AdMobConfig;
    },
    enabled: ADMOB_ENABLED && isNative(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAdMobInit() {
  const initialized = useRef(false);
  const { data: config } = useAdMobConfig();

  useEffect(() => {
    if (!ADMOB_ENABLED || !config?.is_enabled || !config.app_id || initialized.current || !isNative()) return;

    const init = async () => {
      try {
        const { AdMob } = await loadOptionalNativeModule("@capacitor-community/admob");
        await AdMob.initialize({
          initializeForTesting: false,
        });
        initialized.current = true;
        console.log("[AdMob] Initialized successfully");
      } catch (err) {
        console.error("[AdMob] Init failed:", err);
      }
    };

    init();
  }, [config]);
}

export function useAdMobBanner(show: boolean) {
  const shown = useRef(false);
  const { data: config } = useAdMobConfig();

  useEffect(() => {
    if (!ADMOB_ENABLED || !show || !config?.is_enabled || !config.banner_ad_unit_id || !isNative()) {
      // Hide banner if conditions not met
      if (shown.current) {
        loadOptionalNativeModule("@capacitor-community/admob").then(({ AdMob }) => {
          AdMob.removeBanner().catch(() => {});
          shown.current = false;
        });
      }
      return;
    }

    const showBanner = async () => {
      if (shown.current) return;
      try {
        const { AdMob, BannerAdSize, BannerAdPosition } = await loadOptionalNativeModule("@capacitor-community/admob");
        await AdMob.showBanner({
          adId: config.banner_ad_unit_id,
          adSize: BannerAdSize.ADAPTIVE_BANNER,
          position: BannerAdPosition.BOTTOM_CENTER,
          margin: 60, // above bottom nav
        });
        shown.current = true;
        console.log("[AdMob] Banner shown");
      } catch (err) {
        console.error("[AdMob] Banner error:", err);
      }
    };

    showBanner();

    return () => {
      if (shown.current) {
        loadOptionalNativeModule("@capacitor-community/admob").then(({ AdMob }) => {
          AdMob.removeBanner().catch(() => {});
          shown.current = false;
        });
      }
    };
  }, [show, config]);
}
