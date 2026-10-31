import axios from 'axios';
import { api } from './client';

export type ComponentStatus = { status: 'up' | 'down'; message?: string };

export type HealthResponse = {
  status: 'ok' | 'error';
  details: Record<string, ComponentStatus>;
};

/**
 * Lấy trạng thái hệ thống. Backend trả 503 khi có thành phần hỏng nhưng body vẫn
 * chứa chi tiết → vẫn đọc body thay vì coi là lỗi mạng.
 */
export async function fetchHealth(): Promise<HealthResponse> {
  try {
    const { data } = await api.get<HealthResponse>('/health');
    return data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 503) {
      return error.response.data as HealthResponse;
    }
    throw error;
  }
}
