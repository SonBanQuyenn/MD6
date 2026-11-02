import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

/** Một axios instance dùng chung: mọi request đi qua đường dẫn /api cùng domain. */
export const api = axios.create({
  baseURL: '/api',
  timeout: 20_000,
  withCredentials: true, // gửi kèm cookie refresh token (httpOnly)
});

/**
 * Access token chỉ giữ TRONG BỘ NHỚ (không localStorage) → script độc hại (XSS) khó đọc được.
 * Tải lại trang → dùng cookie refresh (httpOnly) để lấy access token mới.
 */
let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export const getAccessToken = () => accessToken;
export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

/** Nhiều request cùng gặp 401 → chỉ gọi refresh MỘT lần, các request còn lại chờ chung. */
let refreshing: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= axios
    .post<{ accessToken: string }>('/api/auth/refresh', null, {
      withCredentials: true,
    })
    .then((res) => {
      setAccessToken(res.data.accessToken);
      return res.data.accessToken;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config as RetriableConfig | undefined;
  const isAuthCall = config?.url?.startsWith('/auth/');
  // Access token hết hạn (15 phút) → refresh rồi gửi lại request đúng 1 lần
  if (
    error.response?.status === 401 &&
    config &&
    !config._retried &&
    !isAuthCall
  ) {
    config._retried = true;
    const token = await refreshAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      return api(config);
    }
    setAccessToken(null);
    onSessionExpired?.();
  }
  return Promise.reject(error);
});

/** Lấy thông điệp lỗi tiếng Việt từ backend (message là chuỗi hoặc mảng lỗi validation). */
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      { message?: string | string[]; retryAfter?: number } | undefined;
    if (Array.isArray(data?.message)) return data.message.join('. ');
    if (data?.message) return data.message;
    if (!error.response) return 'Không kết nối được máy chủ, vui lòng thử lại';
    return `Lỗi ${error.response.status}`;
  }
  return 'Đã có lỗi xảy ra';
}
