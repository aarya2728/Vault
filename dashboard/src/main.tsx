import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { NearProvider } from "./providers/NearProvider.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NearProvider>
      <App />
    </NearProvider>
  </StrictMode>,
);
