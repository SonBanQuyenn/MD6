import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  api,
  getAccessToken,
  refreshAccessToken,
  setAccessToken,
  setSessionExpiredHandler,
} from '../api/client';
import type { Role, User } from '../api/types';

interface AuthState {
  user: User | null;
  /** true trong lúc đang khôi phục phiên từ cookie khi mở trang */
  initializing: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: {
    email: string;
    password: string;
    fullName: string;
  }) => Promise<User>;
  logout: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
  getToken: () => string | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const queryClient = useQueryClient();

  // Mở / tải lại trang: dùng cookie refresh (httpOnly) để khôi phục phiên đăng nhập.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await refreshAccessToken();
      if (token && !cancelled) {
        const { data } = await api.get<User>('/users/me').catch(() => ({
          data: null,
        }));
        if (!cancelled) setUser(data);
      }
      if (!cancelled) setInitializing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      queryClient.clear();
    });
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<{ accessToken: string; user: User }>(
      '/auth/login',
      { email, password },
    );
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; fullName: string }) => {
      const { data } = await api.post<{ accessToken: string; user: User }>(
        '/auth/register',
        input,
      );
      setAccessToken(data.accessToken);
      setUser(data.user);
      return data.user;
    },
    [],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      initializing,
      login,
      register,
      logout,
      hasRole: (...roles) => !!user && roles.includes(user.role),
      getToken: getAccessToken,
    }),
    [user, initializing, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải dùng bên trong <AuthProvider>');
  return ctx;
}

/** Trang mặc định sau khi đăng nhập theo vai trò. */
// eslint-disable-next-line react-refresh/only-export-components
export function homeFor(role: Role): string {
  switch (role) {
    case 'ADMIN':
      return '/admin';
    case 'SUPPORT_AGENT':
      return '/staff/support';
    case 'WAREHOUSE_STAFF':
      return '/staff/orders';
    default:
      return '/';
  }
}
