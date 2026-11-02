import { ConnectionOptions } from 'bullmq';

/**
 * Tạo cấu hình kết nối Redis cho BullMQ từ REDIS_URL.
 *
 * - role "producer" (tiến trình API — chỉ THÊM job): `enableOfflineQueue: false`
 *   → Redis chết thì `queue.add()` báo lỗi NGAY thay vì treo request đặt hàng của khách.
 * - role "worker" (tiến trình worker — XỬ LÝ job): `maxRetriesPerRequest: null`
 *   theo khuyến nghị của BullMQ để worker chờ kết nối lại thay vì bỏ cuộc.
 */
export function bullConnection(
  redisUrl: string,
  role: 'producer' | 'worker',
): ConnectionOptions {
  const url = new URL(redisUrl);
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    ...(role === 'producer'
      ? { enableOfflineQueue: false, maxRetriesPerRequest: 1 }
      : { maxRetriesPerRequest: null }),
  };
}
