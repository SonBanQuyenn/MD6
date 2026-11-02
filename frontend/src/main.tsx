import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios from 'axios';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { theme } from './theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Không thử lại lỗi 4xx (sai quyền, không tìm thấy, 429) — chỉ thử lại lỗi mạng / 5xx
      retry: (count, error) => {
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        return (status === undefined || status >= 500) && count < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
