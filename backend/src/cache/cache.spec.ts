import Redis from 'ioredis';
import { CacheMetrics } from './cache-metrics';
import { CacheService, NULL_MARKER, withJitter } from './cache.service';
import {
  CatalogCacheInvalidator,
  catalogKeys,
  hashQuery,
  SECOND_DELETE_DELAY_MS,
} from './catalog-cache';

/** Redis giả lập trong bộ nhớ — đủ các lệnh CacheService dùng (GET/SET NX/MGET/DEL/INCR/EVAL). */
class FakeRedis {
  store = new Map<string, string>();
  ttl = new Map<string, number>();
  failing = false;

  private guard() {
    if (this.failing) throw new Error('Redis down (giả lập)');
  }
  async get(key: string) {
    this.guard();
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, ...args: (string | number)[]) {
    this.guard();
    if (args.includes('NX') && this.store.has(key)) return null;
    this.store.set(key, value);
    const ex = args.indexOf('EX');
    if (ex >= 0) this.ttl.set(key, Number(args[ex + 1]));
    return 'OK';
  }
  async mget(...keys: string[]) {
    this.guard();
    return keys.map((k) => this.store.get(k) ?? null);
  }
  async del(...keys: string[]) {
    this.guard();
    keys.forEach((k) => this.store.delete(k));
    return keys.length;
  }
  async incr(key: string) {
    this.guard();
    const next = Number(this.store.get(key) ?? 0) + 1;
    this.store.set(key, String(next));
    return next;
  }
  async eval(_script: string, _n: number, key: string, token: string) {
    if (this.store.get(key) === token) this.store.delete(key);
    return 1;
  }
  pipeline() {
    const ops: (() => Promise<unknown>)[] = [];
    const p = {
      set: (...a: [string, string, ...(string | number)[]]) => {
        ops.push(() => this.set(...a));
        return p;
      },
      exec: async () => {
        this.guard();
        for (const op of ops) await op();
        return [];
      },
    };
    return p;
  }
}

describe('CacheService (cache-aside)', () => {
  let redis: FakeRedis;
  let metrics: CacheMetrics;
  let cache: CacheService;
  const opts = { ttlSeconds: 600, nullTtlSeconds: 60 };

  beforeEach(() => {
    redis = new FakeRedis();
    metrics = new CacheMetrics();
    cache = new CacheService(redis as unknown as Redis, metrics);
  });

  it('lần 1 MISS (gọi DB, ghi cache); lần 2 HIT (không gọi DB)', async () => {
    const loader = jest.fn().mockResolvedValue({ price: 100 });

    const first = await cache.getOrLoad('product:1', loader, opts);
    const second = await cache.getOrLoad('product:1', loader, opts);

    expect(first).toEqual({ value: { price: 100 }, status: 'MISS' });
    expect(second).toEqual({ value: { price: 100 }, status: 'HIT' });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(metrics.snapshot()).toMatchObject({ hits: 1, misses: 1 });
  });

  it('CHỐNG DỒN DẬP: 50 request cùng lúc khi cache trống → DB chỉ bị gọi 1 lần', async () => {
    const loader = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 50)); // DB chậm 50ms
      return { price: 100 };
    });

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        cache.getOrLoad('product:hot', loader, opts),
      ),
    );

    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.value?.price === 100)).toBe(true);
    expect(metrics.snapshot().lockWaits).toBe(49);
    expect(redis.store.has('lock:product:hot')).toBe(false); // khoá đã được giải phóng
  });

  it('CHỐNG DÒ KHOÁ: id không tồn tại → lưu NULL_MARKER 60s, lần sau không gọi DB', async () => {
    const loader = jest.fn().mockResolvedValue(null);

    await cache.getOrLoad('product:none', loader, opts);
    const again = await cache.getOrLoad('product:none', loader, opts);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(again).toEqual({ value: null, status: 'HIT' });
    expect(redis.store.get('product:none')).toBe(NULL_MARKER);
    expect(redis.ttl.get('product:none')).toBe(60);
    expect(metrics.snapshot().nullHits).toBe(1);
  });

  it('REDIS HỎNG: vẫn trả dữ liệu từ DB (BYPASS), không ném lỗi', async () => {
    redis.failing = true;
    const loader = jest.fn().mockResolvedValue({ price: 100 });

    await expect(cache.getOrLoad('product:1', loader, opts)).resolves.toEqual({
      value: { price: 100 },
      status: 'BYPASS',
    });
    await expect(cache.getMany(['a', 'b'])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    await expect(cache.getNumber('catalog:version')).resolves.toBeNull();
    await expect(cache.del('a')).resolves.toBeUndefined();
    expect(metrics.snapshot().errors).toBeGreaterThanOrEqual(4);
  });

  it('getMany / setMany: phân biệt "chưa có" (undefined) và "không tồn tại" (null)', async () => {
    await cache.setMany(
      [
        { key: 'p:1', value: { id: 1 } },
        { key: 'p:2', value: null },
      ],
      opts,
    );
    await expect(cache.getMany(['p:1', 'p:2', 'p:3'])).resolves.toEqual([
      { id: 1 },
      null,
      undefined,
    ]);
  });

  it('TTL có độ lệch ngẫu nhiên ±10% (tránh nhiều khoá hết hạn cùng lúc)', () => {
    const values = Array.from({ length: 200 }, () => withJitter(600));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(540);
    expect(Math.max(...values)).toBeLessThanOrEqual(660);
    expect(new Set(values).size).toBeGreaterThan(10);
  });
});

describe('Khoá cache danh mục', () => {
  it('cùng bộ lọc (khác thứ tự, có giá trị rỗng) → cùng khoá', () => {
    expect(hashQuery({ page: 1, brandId: 'b', q: undefined })).toBe(
      hashQuery({ brandId: 'b', page: 1, q: '' }),
    );
    expect(hashQuery({ page: 1 })).not.toBe(hashQuery({ page: 2 }));
  });

  it('khoá danh sách chứa version → tăng version là mọi khoá cũ vô hiệu', () => {
    expect(catalogKeys.productList(3, { page: 1 })).not.toBe(
      catalogKeys.productList(4, { page: 1 }),
    );
  });
});

describe('CatalogCacheInvalidator', () => {
  afterEach(() => jest.useRealTimers());

  it('xoá cache chi tiết NGAY và xoá lần 2 sau 1 giây (chống ghi đè giá cũ)', async () => {
    jest.useFakeTimers();
    const cache = { del: jest.fn(), incr: jest.fn() };
    const invalidator = new CatalogCacheInvalidator(
      cache as unknown as CacheService,
    );

    await invalidator.invalidateProducts(['p1', 'p1', 'p2']);
    expect(cache.del).toHaveBeenCalledTimes(1);
    expect(cache.del).toHaveBeenCalledWith('product:p1', 'product:p2');

    jest.advanceTimersByTime(SECOND_DELETE_DELAY_MS);
    expect(cache.del).toHaveBeenCalledTimes(2);
  });

  it('invalidateLists tăng catalog:version', async () => {
    const cache = { del: jest.fn(), incr: jest.fn() };
    await new CatalogCacheInvalidator(
      cache as unknown as CacheService,
    ).invalidateLists();
    expect(cache.incr).toHaveBeenCalledWith('catalog:version');
  });
});
