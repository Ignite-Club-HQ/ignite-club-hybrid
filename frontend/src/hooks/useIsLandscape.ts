import { useState, useEffect } from "react";

interface LandscapeState {
  isLandscape: boolean;
  isMobileLandscape: boolean;
  isTabletLandscape: boolean;
  isDesktopLandscape: boolean;
}

// Hook to detect landscape orientation and screen size
// Breakpoints: mobile < 500px height, tablet 500-800px, desktop > 800px
export function useIsLandscape(): LandscapeState {
  const [state, setState] = useState<LandscapeState>(() => {
    if (typeof window !== "undefined") {
      const isLandscape = window.innerWidth > window.innerHeight;
      const isMobileLandscape = isLandscape && window.innerHeight < 500;
      const isTabletLandscape = isLandscape && window.innerHeight >= 500 && window.innerHeight <= 800;
      const isDesktopLandscape = isLandscape && window.innerHeight > 800;
      return { isLandscape, isMobileLandscape, isTabletLandscape, isDesktopLandscape };
    }
    return { isLandscape: false, isMobileLandscape: false, isTabletLandscape: false, isDesktopLandscape: false };
  });

  useEffect(() => {
    const handleResize = () => {
      const isLandscape = window.innerWidth > window.innerHeight;
      const isMobileLandscape = isLandscape && window.innerHeight < 500;
      const isTabletLandscape = isLandscape && window.innerHeight >= 500 && window.innerHeight <= 800;
      const isDesktopLandscape = isLandscape && window.innerHeight > 800;
      setState({ isLandscape, isMobileLandscape, isTabletLandscape, isDesktopLandscape });
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  return state;
}
