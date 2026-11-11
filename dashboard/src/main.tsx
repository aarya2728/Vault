import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { NearProvider } from "./providers/NearProvider.js";
import { ThemeProvider } from "./providers/ThemeProvider.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <NearProvider>
        <App />
      </NearProvider>
    </ThemeProvider>
  </StrictMode>,
);
