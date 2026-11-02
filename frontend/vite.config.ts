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
      // ws: true → chuyển tiếp cả kết nối WebSocket của Socket.IO (/api/socket.io)
      '/api': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Tách thư viện ra file riêng: thư viện ít đổi → trình duyệt cache lâu, mỗi lần
        // deploy chỉ tải lại phần code ứng dụng.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          data: ['@tanstack/react-query', 'axios', 'socket.io-client'],
          mantine: [
            '@mantine/core',
            '@mantine/hooks',
            '@mantine/form',
            '@mantine/notifications',
          ],
          icons: ['@tabler/icons-react'],
        },
      },
    },
  },
});
