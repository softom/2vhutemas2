import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Новый контур живёт на отдельном пути, пока не заменит старый сайт (Р-21).
export default defineConfig({
  plugins: [react()],
  base: "/new/",
  build: { outDir: "dist", sourcemap: false },
});
