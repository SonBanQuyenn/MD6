import Redis from 'ioredis';

/**
 * Chạy trước MỖI test của mọi file integration: xoá sạch Redis DB dành cho test
 * (cache, bộ đếm rate limit, hàng đợi) → dữ liệu cache của test trước không "rò" sang test sau.
 * Có chốt an toàn: chỉ xoá khi đang chạy với NODE_ENV=test và KHÔNG phải DB số 0.
 */
let redis: Redis | undefined;

beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true });
});

beforeEach(async () => {
  const db = new URL(process.env.REDIS_URL!).pathname.slice(1);
  if (process.env.NODE_ENV !== 'test' || db === '' || db === '0') {
    throw new Error('Từ chối FLUSHDB: không phải Redis DB dành cho test');
  }
  await redis!.flushdb();
});

afterAll(async () => {
  await redis?.quit();
});
