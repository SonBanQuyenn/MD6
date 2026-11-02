import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { LoginAttemptsService, lockDurationMs } from './login-attempts.service';
import { RateLimitGuard, TooManyRequestsException } from './rate-limit.guard';
import { buildPolicies, formatMessage } from './rate-limit.policies';
import { HitResult, RateLimitStore } from './rate-limit.store';

/** Store giả trong bộ nhớ: đếm theo key, cửa sổ còn 30 giây. */
class FakeStore {
  counts = new Map<string, number>();
  failing = false;
  async hit(key: string): Promise<HitResult | null> {
    if (this.failing) return null;
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { count, resetMs: 30_000 };
  }
}

function httpContext(
  req: Record<string, unknown>,
  routePolicy?: string,
): { ctx: ExecutionContext; headers: Record<string, unknown> } {
  const headers: Record<string, unknown> = {};
  const res = { setHeader: (k: string, v: unknown) => (headers[k] = v) };
  const handler = () => undefined;
  if (routePolicy)
    Reflect.defineMetadata('rateLimitPolicy', routePolicy, handler);
  const ctx = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { ctx, headers };
}

describe('RateLimitGuard', () => {
  let store: FakeStore;
  let jwt: { verifyAsync: jest.Mock };
  let guard: RateLimitGuard;

  beforeEach(() => {
    store = new FakeStore();
    jwt = { verifyAsync: jest.fn() };
    guard = new RateLimitGuard(
      store as unknown as RateLimitStore,
      new Reflector(),
      jwt as unknown as JwtService,
      buildPolicies(3),
    );
  });

  const anon = (ip = '1.1.1.1') => ({ ip, headers: {} });

  it('cho qua khi chưa vượt hạn mức và gắn header X-RateLimit-*', async () => {
    const { ctx, headers } = httpContext(anon());
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(headers['X-RateLimit-Limit']).toBe(3);
    expect(headers['X-RateLimit-Remaining']).toBe(2);
  });

  it('vượt hạn mức chung → 429, Retry-After và thông điệp tiếng Việt', async () => {
    for (let i = 0; i < 3; i++) {
      await guard.canActivate(httpContext(anon()).ctx);
    }
    const { ctx, headers } = httpContext(anon());
    const error = await guard.canActivate(ctx).catch((e) => e);
    expect(error).toBeInstanceOf(TooManyRequestsException);
    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toMatchObject({
      retryAfter: 30,
      message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau 30 giây.',
    });
    expect(headers['Retry-After']).toBe(30);
  });

  it('đếm riêng từng IP khi chưa đăng nhập', async () => {
    for (let i = 0; i < 3; i++)
      await guard.canActivate(httpContext(anon()).ctx);
    await expect(
      guard.canActivate(httpContext(anon('2.2.2.2')).ctx),
    ).resolves.toBe(true);
  });

  it('token hợp lệ → đếm theo tài khoản, đổi IP không lách được', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    const req = (ip: string) => ({
      ip,
      headers: { authorization: 'Bearer token' },
    });
    for (let i = 0; i < 3; i++) {
      await guard.canActivate(httpContext(req(`10.0.0.${i}`)).ctx);
    }
    await expect(
      guard.canActivate(httpContext(req('10.0.0.99')).ctx),
    ).rejects.toBeInstanceOf(TooManyRequestsException);
    expect([...store.counts.keys()]).toEqual(['rl:global:user:user-1']);
  });

  it('token sai → coi như khách vãng lai, đếm theo IP', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('invalid'));
    await guard.canActivate(
      httpContext({ ip: '3.3.3.3', headers: { authorization: 'Bearer x' } })
        .ctx,
    );
    expect(store.counts.has('rl:global:ip:3.3.3.3')).toBe(true);
  });

  it('endpoint có @RateLimit → kiểm tra thêm hạn mức riêng', async () => {
    await guard.canActivate(httpContext(anon(), 'login').ctx);
    expect(store.counts.get('rl:global:ip:1.1.1.1')).toBe(1);
    expect(store.counts.get('rl:login:ip:1.1.1.1')).toBe(1);
  });

  it('đăng nhập luôn đếm theo IP kể cả khi gửi kèm token', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    await guard.canActivate(
      httpContext(
        { ip: '4.4.4.4', headers: { authorization: 'Bearer t' } },
        'login',
      ).ctx,
    );
    expect(store.counts.has('rl:login:ip:4.4.4.4')).toBe(true);
  });

  it('Redis lỗi → fail-open, vẫn cho request đi qua', async () => {
    store.failing = true;
    for (let i = 0; i < 10; i++) {
      await expect(guard.canActivate(httpContext(anon()).ctx)).resolves.toBe(
        true,
      );
    }
  });

  it('bỏ qua ngữ cảnh không phải HTTP (WebSocket)', async () => {
    const ctx = { getType: () => 'ws' } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(store.counts.size).toBe(0);
  });
});

describe('formatMessage', () => {
  it('điền số giây vào thông điệp', () => {
    expect(formatMessage(buildPolicies(100).promoOrder, 12)).toBe(
      'Bạn đặt đơn khuyến mãi quá nhanh, vui lòng thử lại sau 12 giây.',
    );
  });
});

describe('lockDurationMs — khoá leo thang', () => {
  it.each([
    [1, 0],
    [4, 0],
    [5, 60_000],
    [6, 0],
    [10, 15 * 60_000],
    [15, 60 * 60_000],
    [20, 60 * 60_000],
  ])('%i lần sai → khoá %i ms', (failures, expected) => {
    expect(lockDurationMs(failures)).toBe(expected);
  });
});

describe('LoginAttemptsService', () => {
  /** Redis giả tối thiểu: chỉ các lệnh service dùng. */
  function fakeRedis() {
    const values = new Map<string, number>();
    const ttl = new Map<string, number>();
    return {
      values,
      ttl,
      down: false,
      async eval(_script: string, _n: number, key: string) {
        if (this.down) throw new Error('redis down');
        const v = (values.get(key) ?? 0) + 1;
        values.set(key, v);
        return v;
      },
      async set(key: string, _v: string, _px: string, ms: number) {
        if (this.down) throw new Error('redis down');
        ttl.set(key, ms);
        return 'OK';
      },
      async pttl(key: string) {
        if (this.down) throw new Error('redis down');
        return ttl.get(key) ?? -2;
      },
      async del(...keys: string[]) {
        keys.forEach((k) => {
          values.delete(k);
          ttl.delete(k);
        });
        return keys.length;
      },
    };
  }

  it('4 lần sai chưa khoá; lần thứ 5 khoá 1 phút và ném 429', async () => {
    const redis = fakeRedis();
    const service = new LoginAttemptsService(redis as unknown as Redis);
    for (let i = 0; i < 4; i++) {
      await expect(service.recordFailure('a@x.com')).resolves.toBeUndefined();
    }
    await expect(service.recordFailure('a@x.com')).rejects.toBeInstanceOf(
      TooManyRequestsException,
    );
    await expect(service.assertNotLocked('A@X.com ')).rejects.toThrow(
      /tạm thời bị khoá/,
    );
  });

  it('đăng nhập đúng → xoá bộ đếm và khoá', async () => {
    const redis = fakeRedis();
    const service = new LoginAttemptsService(redis as unknown as Redis);
    for (let i = 0; i < 3; i++) await service.recordFailure('a@x.com');
    await service.recordSuccess('a@x.com');
    expect(redis.values.size).toBe(0);
  });

  it('khoá theo tài khoản: email khác không bị ảnh hưởng', async () => {
    const redis = fakeRedis();
    const service = new LoginAttemptsService(redis as unknown as Redis);
    for (let i = 0; i < 5; i++) {
      await service.recordFailure('victim@x.com').catch(() => undefined);
    }
    await expect(
      service.assertNotLocked('other@x.com'),
    ).resolves.toBeUndefined();
  });

  it('Redis lỗi → dùng bộ đếm dự phòng trong bộ nhớ, vẫn khoá được', async () => {
    const redis = fakeRedis();
    redis.down = true;
    const service = new LoginAttemptsService(redis as unknown as Redis);
    for (let i = 0; i < 4; i++) await service.recordFailure('a@x.com');
    await expect(service.recordFailure('a@x.com')).rejects.toBeInstanceOf(
      TooManyRequestsException,
    );
    await expect(service.assertNotLocked('a@x.com')).rejects.toBeInstanceOf(
      TooManyRequestsException,
    );
  });
});
