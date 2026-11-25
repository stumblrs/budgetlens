import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

const isVitest = Boolean(process.env.VITEST);

export default defineConfig({
  plugins: [react(), ...(isVitest ? [] : [cloudflare()])],
  server:
    process.env.VITE_LEGACY_FASTAPI_PROXY === '1'
      ? {
          proxy: {
            '/api': 'http://127.0.0.1:8000',
          },
        }
      : undefined,
  worker: {
    format: 'es',
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          const norm = id.replace(/\\/g, '/');
          if (!norm.includes('/node_modules/')) return undefined;
          if (
            norm.includes('/node_modules/react/') ||
            norm.includes('/node_modules/react-dom/') ||
            norm.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
          if (
            norm.includes('/node_modules/recharts/') ||
            norm.includes('/node_modules/d3-') ||
            norm.includes('/node_modules/victory-vendor/')
          ) {
            return 'vendor-charts';
          }
          if (norm.includes('/node_modules/lucide-react/')) {
            return 'vendor-icons';
          }
          if (
            norm.includes('/node_modules/jspdf') ||
            norm.includes('/node_modules/fflate/') ||
            norm.includes('/node_modules/html2canvas/')
          ) {
            return 'vendor-pdf';
          }
          if (norm.includes('/node_modules/docx/')) {
            return 'vendor-docx';
          }
          return undefined;
        },
      },
    },
  },
});
