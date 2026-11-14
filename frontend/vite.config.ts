import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // The dashboard talks to the FastAPI backend on :8000 during development.
      "/api": {
        target: process.env.VITE_API_PROXY || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          radix: ["@radix-ui/react-slot"],
          charts: ["recharts"],
        },
      },
    },
    // Keep the initial shell lean; charts load on demand with the calendar page.
    chunkSizeWarningLimit: 420,
  },
  preview: { port: 5173 },
})
