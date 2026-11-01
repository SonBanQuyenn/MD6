import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { CacheMetrics } from './cache-metrics';

/** Giá trị đánh dấu "không tồn tại" — chống dò khoá không tồn tại (cache penetration). */
export const NULL_MARKER = '__NULL__';

/** HIT: lấy từ cache · MISS: nạp từ DB rồi ghi cache · BYPASS: Redis lỗi, đọc thẳng DB */
export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS';

export interface CacheResult<T> {
  value: T;
  status: CacheStatus;
}

export interface GetOrLoadOptions {
  /** Thời gian sống (giây) của giá trị thật */
  ttlSeconds: number;
  /** Thời gian sống (giây) của NULL_MARKER — ngắn để dữ liệu mới tạo sớm hiện ra */
  nullTtlSeconds?: number;
}

const LOCK_TTL_MS = 3_000;
const LOCK_WAIT_STEP_MS = 25;
const LOCK_WAIT_MAX_MS = 1_000;

// Chỉ xoá khoá nếu đúng là khoá của mình (tránh xoá nhầm khoá đã hết hạn rồi bị người khác lấy).
const RELEASE_LOCK_LUA = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/**
 * Cache-aside dùng Redis (F04):
 *   1. Đọc cache → có thì trả luôn (HIT).
 *   2. Không có → CHỈ MỘT request giành được khoá `lock:<key>` để nạp DB và ghi cache;
 *      các request khác chờ ngắn rồi đọc lại cache (chống dồn dập — cache stampede).
 *   3. DB trả "không có" → lưu NULL_MARKER với TTL ngắn (chống cache penetration).
 *   4. Redis lỗi ở BẤT KỲ bước nào → bỏ qua cache, đọc thẳng DB (BYPASS) — chậm hơn nhưng không sập.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly metrics: CacheMetrics,
  ) {}

  async getOrLoad<T>(
    key: string,
    loader: () => Promise<T | null>,
    options: GetOrLoadOptions,
  ): Promise<CacheResult<T | null>> {
    let cached: string | null;
    try {
      cached = await this.redis.get(key);
    } catch (error) {
      return this.bypass(key, loader, error);
    }
    if (cached !== null)
      return { value: this.decode<T>(cached), status: 'HIT' };

    this.metrics.miss();
    const token = randomUUID();
    let locked = false;
    try {
      locked =
        (await this.redis.set(
          `lock:${key}`,
          token,
          'PX',
          LOCK_TTL_MS,
          'NX',
        )) === 'OK';
    } catch (error) {
      return this.bypassAfterMiss(key, loader, error);
    }

    if (!locked) {
      // Người khác đang nạp → chờ họ ghi cache thay vì cùng đập vào DB.
      this.metrics.lockWait();
      const waited = await this.waitForValue<T>(key);
      if (waited !== undefined) return { value: waited, status: 'HIT' };
      // Chờ quá lâu → tự đọc DB (không treo request), không ghi cache.
      return { value: await loader(), status: 'MISS' };
    }

    try {
      const value = await loader();
      await this.write(key, value, options);
      return { value, status: 'MISS' };
    } finally {
      await this.redis
        .eval(RELEASE_LOCK_LUA, 1, `lock:${key}`, token)
        .catch(() => undefined);
    }
  }

  /** Đọc nhiều khoá một lần (MGET). Lỗi Redis → coi như không có gì trong cache. */
  async getMany<T>(keys: string[]): Promise<(T | null | undefined)[]> {
    if (keys.length === 0) return [];
    try {
      const values = await this.redis.mget(...keys);
      return values.map((v) => {
        if (v === null) {
          this.metrics.miss();
          return undefined;
        }
        return this.decode<T>(v);
      });
    } catch (error) {
      this.metrics.error();
      this.logger.warn(`Redis MGET lỗi, bỏ qua cache: ${String(error)}`);
      return keys.map(() => undefined);
    }
  }

  async setMany<T>(
    entries: { key: string; value: T | null }[],
    options: GetOrLoadOptions,
  ): Promise<void> {
    if (entries.length === 0) return;
    try {
      const pipeline = this.redis.pipeline();
      for (const { key, value } of entries) {
        const [payload, ttl] = this.encode(value, options);
        pipeline.set(key, payload, 'EX', ttl);
      }
      await pipeline.exec();
    } catch (error) {
      this.metrics.error();
      this.logger.warn(`Redis pipeline SET lỗi: ${String(error)}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.redis.del(...keys);
    } catch (error) {
      this.metrics.error();
      this.logger.warn(`Redis DEL lỗi (${keys.length} khoá): ${String(error)}`);
    }
  }

  /** Đọc số nguyên (ví dụ version của danh sách). Lỗi → null. */
  async getNumber(key: string): Promise<number | null> {
    try {
      const value = await this.redis.get(key);
      return value === null ? 0 : Number(value);
    } catch {
      this.metrics.error();
      return null;
    }
  }

  async incr(key: string): Promise<void> {
    try {
      await this.redis.incr(key);
    } catch (error) {
      this.metrics.error();
      this.logger.warn(`Redis INCR ${key} lỗi: ${String(error)}`);
    }
  }

  private async write<T>(
    key: string,
    value: T | null,
    options: GetOrLoadOptions,
  ): Promise<void> {
    const [payload, ttl] = this.encode(value, options);
    await this.redis.set(key, payload, 'EX', ttl).catch((error) => {
      this.metrics.error();
      this.logger.warn(`Redis SET ${key} lỗi: ${String(error)}`);
    });
  }

  private encode<T>(
    value: T | null,
    options: GetOrLoadOptions,
  ): [string, number] {
    return value === null
      ? [NULL_MARKER, options.nullTtlSeconds ?? 60]
      : [JSON.stringify(value), withJitter(options.ttlSeconds)];
  }

  private decode<T>(raw: string): T | null {
    if (raw === NULL_MARKER) {
      this.metrics.hit(true);
      return null;
    }
    this.metrics.hit();
    return JSON.parse(raw) as T;
  }

  private async waitForValue<T>(key: string): Promise<T | null | undefined> {
    for (
      let waited = 0;
      waited < LOCK_WAIT_MAX_MS;
      waited += LOCK_WAIT_STEP_MS
    ) {
      await sleep(LOCK_WAIT_STEP_MS);
      const value = await this.redis.get(key).catch(() => null);
      if (value !== null) return this.decode<T>(value);
    }
    return undefined;
  }

  private async bypass<T>(
    key: string,
    loader: () => Promise<T | null>,
    error: unknown,
  ): Promise<CacheResult<T | null>> {
    this.metrics.error();
    this.logger.warn(
      `Redis lỗi khi đọc ${key}, đọc thẳng DB: ${String(error)}`,
    );
    return { value: await loader(), status: 'BYPASS' };
  }

  private async bypassAfterMiss<T>(
    key: string,
    loader: () => Promise<T | null>,
    error: unknown,
  ): Promise<CacheResult<T | null>> {
    this.metrics.error();
    this.logger.warn(`Redis lỗi khi giữ khoá ${key}: ${String(error)}`);
    return { value: await loader(), status: 'BYPASS' };
  }
}

/**
 * TTL ± 10% ngẫu nhiên: các khoá được ghi cùng lúc sẽ hết hạn RẢI RÁC,
 * tránh nhiều khoá nóng hết hạn đồng loạt rồi cùng đổ về DB.
 */
export function withJitter(ttlSeconds: number): number {
  const spread = Math.floor(ttlSeconds * 0.1);
  return ttlSeconds - spread + Math.floor(Math.random() * (2 * spread + 1));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
