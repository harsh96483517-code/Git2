import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Same-origin proxy so the httpOnly session cookie works in dev.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787', '/auth': 'http://localhost:8787' } }
});
