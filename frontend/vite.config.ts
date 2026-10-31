import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Khi dev: request tới /api được chuyển sang backend NestJS.
    // Trình duyệt chỉ thấy 1 địa chỉ → không cần cấu hình CORS.
    // Production: Nginx làm đúng việc này.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
