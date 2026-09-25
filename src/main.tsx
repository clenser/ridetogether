import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AppProvider } from "./context/AppContext";
import { AuthProvider } from "./context/AuthContext";
import { isSupabaseConfigured } from "./services/supabase";
import { initializeAppearance } from "./services/theme";
import "maplibre-gl/dist/maplibre-gl.css";
import "./index.css";

initializeAppearance();

if (import.meta.env.DEV) {
  console.info(
    isSupabaseConfigured()
      ? "[supabase] Client configuration detected. Sign in with your Supabase account to continue."
      : "[supabase] Client not configured. Copy .env.example to .env and set the public project URL and publishable key.",
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
