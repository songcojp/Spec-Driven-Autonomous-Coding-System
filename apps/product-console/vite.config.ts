import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "apps/product-console",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/console": {
        target: process.env.CONSOLE_API_BASE_URL ?? "http://localhost:4317",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../../dist/product-console",
    emptyOutDir: true,
  },
});
