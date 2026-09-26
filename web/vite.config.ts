import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Новый контур — основной сайт; прежний ушёл под /old (Р-59).
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: { outDir: "dist", sourcemap: false },
});
