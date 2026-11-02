import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { TooManyRequestsException } from './rate-limit.guard';

const MINUTE = 60_000;
/** Bộ đếm lần sai được giữ 24 giờ kể từ lần sai đầu tiên. */
const FAIL_WINDOW_MS = 24 * 60 * MINUTE;
/** Cứ mỗi 5 lần sai → khoá 1 lần. */
const FAILS_PER_STEP = 5;

/**
 * Khoá LEO THANG (F03.4): càng sai nhiều, khoá càng lâu.
 *  5 lần sai → khoá 1 phút · 10 lần → 15 phút · từ 15 lần → 60 phút.
 */
export function lockDurationMs(failures: number): number {
  if (failures < FAILS_PER_STEP || failures % FAILS_PER_STEP !== 0) return 0;
  if (failures >= 3 * FAILS_PER_STEP) return 60 * MINUTE;
  if (failures >= 2 * FAILS_PER_STEP) return 15 * MINUTE;
  return MINUTE;
}

const FAIL_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`;

interface MemoryEntry {
  failures: number;
  resetAt: number;
  lockedUntil: number;
}

/**
 * Chống dò mật khẩu, đếm theo TÀI KHOẢN MỤC TIÊU (email), không theo IP:
 * kẻ tấn công xoay vòng hàng nghìn IP vẫn bị chặn trên đúng tài khoản đang bị dò.
 *
 * Đánh đổi (ghi trong security-report): kẻ xấu có thể cố tình nhập sai để khoá tạm tài khoản
 * người khác. Giảm thiểu: khoá ngắn và có thời hạn, đăng nhập đúng xoá bộ đếm, log cảnh báo.
 *
 * Redis lỗi → dùng bộ đếm trong bộ nhớ của tiến trình (dự phòng): kém chính xác hơn khi chạy
 * nhiều instance, nhưng KHÔNG mở toang cho việc dò mật khẩu.
 */
@Injectable()
export class LoginAttemptsService {
  private readonly logger = new Logger(LoginAttemptsService.name);
  private readonly memory = new Map<string, MemoryEntry>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Tài khoản đang bị khoá → ném 429 kèm thời gian chờ. */
  async assertNotLocked(email: string): Promise<void> {
    const id = accountId(email);
    let remainingMs: number;
    try {
      remainingMs = await this.redis.pttl(lockKey(id));
    } catch {
      remainingMs = (this.memory.get(id)?.lockedUntil ?? 0) - Date.now();
    }
    if (remainingMs > 0) throw lockedError(remainingMs);
  }

  /** Ghi nhận 1 lần sai; đủ ngưỡng → khoá và ném 429 ngay. */
  async recordFailure(email: string): Promise<void> {
    const id = accountId(email);
    let failures: number;
    try {
      failures = (await this.redis.eval(
        FAIL_SCRIPT,
        1,
        failKey(id),
        FAIL_WINDOW_MS,
      )) as number;
      const lockMs = lockDurationMs(failures);
      if (lockMs > 0) await this.redis.set(lockKey(id), '1', 'PX', lockMs);
    } catch {
      failures = this.memoryFailure(id);
    }

    const lockMs = lockDurationMs(failures);
    if (lockMs > 0) {
      this.logger.warn(
        `Khoá đăng nhập ${lockMs / MINUTE} phút cho tài khoản ${id.slice(0, 12)}… sau ${failures} lần sai`,
      );
      throw lockedError(lockMs);
    }
  }

  /** Đăng nhập đúng → xoá bộ đếm. */
  async recordSuccess(email: string): Promise<void> {
    const id = accountId(email);
    this.memory.delete(id);
    await this.redis.del(failKey(id), lockKey(id)).catch(() => undefined);
  }

  private memoryFailure(id: string): number {
    const now = Date.now();
    const entry = this.memory.get(id);
    const current =
      entry && entry.resetAt > now
        ? entry
        : { failures: 0, resetAt: now + FAIL_WINDOW_MS, lockedUntil: 0 };
    current.failures += 1;
    const lockMs = lockDurationMs(current.failures);
    if (lockMs > 0) current.lockedUntil = now + lockMs;
    this.memory.set(id, current);
    return current.failures;
  }
}

/** Băm email để khoá Redis không chứa dữ liệu cá nhân dạng rõ. */
function accountId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}
const failKey = (id: string) => `login:fail:${id}`;
const lockKey = (id: string) => `login:lock:${id}`;

function lockedError(remainingMs: number) {
  const seconds = Math.ceil(remainingMs / 1000);
  const human =
    seconds >= 60 ? `${Math.ceil(seconds / 60)} phút` : `${seconds} giây`;
  return new TooManyRequestsException(
    `Tài khoản tạm thời bị khoá đăng nhập do nhập sai mật khẩu nhiều lần. Vui lòng thử lại sau ${human} hoặc đặt lại mật khẩu.`,
    seconds,
  );
}
