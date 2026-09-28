import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initWebVitalsTelemetry } from "./lib/observability/webVitals";
import { installSupabaseAuthRetry } from "./lib/supabaseAuthRetry";
import "./index.css";

installSupabaseAuthRetry();
initWebVitalsTelemetry();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Product root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
