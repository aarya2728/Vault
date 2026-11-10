import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/Vault/" : "/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },
});
