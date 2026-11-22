import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Новый контур — основной сайт; прежний ушёл под /old (Р-59).
export default defineConfig({
  plugins: [react(), {
    name: "auth-config",
    apply: "build",
    configResolved(config) {
      for (const key of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]) {
        if (!config.env[key]?.trim()) throw new Error(`Для сборки клиента требуется ${key}`);
      }
    },
  }],
  base: "/",
  build: { outDir: "dist", sourcemap: false, rollupOptions: { input: { index: "index.html", stili: "games/stili.html" } } },
});
