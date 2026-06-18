import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Read the shared repo-root .env (VITE_-prefixed vars only are exposed).
  envDir: "..",
  server: { port: Number(process.env.WEB_PORT ?? 5173) },
});
