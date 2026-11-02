import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

export interface HitResult {
  /** Số request đã đếm trong cửa sổ hiện tại (kể cả request này). */
  count: number;
  /** Số mili giây còn lại tới khi cửa sổ kết thúc (bộ đếm về 0). */
  resetMs: number;
}

/**
 * INCR + đặt hạn trong MỘT lệnh Lua → nguyên tử. Nếu tách 2 lệnh, tiến trình chết giữa chừng
 * sẽ để lại khoá không có TTL → người dùng bị chặn vĩnh viễn.
 */
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/**
 * Bộ đếm "cửa sổ cố định" (fixed window) lưu trong Redis → mọi instance API (blue/green)
 * dùng chung một bộ đếm, hạn mức không bị nhân đôi.
 */
@Injectable()
export class RateLimitStore {
  private readonly logger = new Logger(RateLimitStore.name);
  private lastWarnAt = 0;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Đếm 1 lần truy cập. Redis lỗi → trả `null` (FAIL-OPEN: vẫn cho request đi qua).
   * Lý do: hạn mức chung chỉ để chống lạm dụng; chặn TOÀN BỘ khách chỉ vì Redis hỏng còn tệ hơn.
   * Riêng đăng nhập có lớp chống dò mật khẩu với bộ đếm dự phòng trong bộ nhớ (LoginAttemptsService).
   */
  async hit(key: string, windowMs: number): Promise<HitResult | null> {
    try {
      const [count, ttl] = (await this.redis.eval(
        HIT_SCRIPT,
        1,
        key,
        windowMs,
      )) as [number, number];
      return { count, resetMs: ttl };
    } catch (error) {
      this.warn(error);
      return null;
    }
  }

  /** Ghi log tối đa 1 lần / 30 giây để Redis hỏng không làm ngập log. */
  private warn(error: unknown) {
    const now = Date.now();
    if (now - this.lastWarnAt < 30_000) return;
    this.lastWarnAt = now;
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Rate limit tạm tắt (fail-open) do Redis lỗi: ${message}`);
  }
}
