import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { setAppNavigator } from "@/lib/appNavigator";
import { markLaunchNavigationCommitted } from "@/lib/nativeLaunchIntent";

/**
 * Registers the router's `navigate` with the app navigator bridge so non-React
 * code (deep links, push handlers) can do soft SPA navigation instead of a
 * hard `window.location.href` reload.
 *
 * It also acknowledges committed Router locations to the native launch-intent
 * boundary: the cold-start startup gate is only released once the Router has
 * actually committed the retained launch destination (e.g. `/join/p/:token`),
 * never merely because navigation was requested.
 */
export default function AppNavigatorBridge() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setAppNavigator((path, opts) => navigate(path, { replace: opts?.replace }));
    return () => setAppNavigator(null);
  }, [navigate]);

  useEffect(() => {
    markLaunchNavigationCommitted({
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    });
  }, [location.pathname, location.search, location.hash]);

  return null;
}
