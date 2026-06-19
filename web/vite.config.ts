import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // "@/..." resolves to web/src/... (shadcn convention).
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Read the shared repo-root .env (VITE_-prefixed vars only are exposed).
  envDir: "..",
  server: { port: Number(process.env.WEB_PORT ?? 5173) },
});
