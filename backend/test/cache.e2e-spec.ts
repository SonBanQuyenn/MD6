import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import * as request from 'supertest';
import { ProductsRepository } from '../src/catalog/products/products.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/redis/redis.constants';
import { createTestApp, createUser, loginAs, resetDatabase } from './utils';

/**
 * Integration test F04 trên Redis + PostgreSQL THẬT.
 * Dùng spy trên ProductsRepository để đếm số lần thật sự truy vấn DB.
 */
describe('Redis cache (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let repo: ProductsRepository;
  const http = () => request(app.getHttpServer());

  let admin: string;
  let warehouse: string;
  let customer: string;
  let productId: string;
  let categoryId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const detail = (id = productId) => http().get(`/api/products/${id}`);
  const listUrl = () => `/api/products?categoryId=${categoryId}&sort=price_asc`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS_CLIENT);
    repo = app.get(ProductsRepository);
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase(prisma);
    await redis.flushdb();
    admin = (await loginAs(app, (await createUser(prisma, Role.ADMIN)).email))
      .accessToken;
    warehouse = (
      await loginAs(app, (await createUser(prisma, Role.WAREHOUSE_STAFF)).email)
    ).accessToken;
    customer = (
      await loginAs(app, (await createUser(prisma, Role.CUSTOMER)).email)
    ).accessToken;

    categoryId = (
      await prisma.category.create({ data: { name: 'Loa', slug: 'loa' } })
    ).id;
    const brand = await prisma.brand.create({
      data: { name: 'JBL', slug: 'jbl' },
    });
    for (const [sku, price] of [
      ['LO-1', 1_000_000],
      ['LO-2', 2_000_000],
    ] as const) {
      await prisma.product.create({
        data: {
          sku,
          name: `Loa ${sku}`,
          slug: sku.toLowerCase(),
          price,
          stock: 10,
          categoryId,
          brandId: brand.id,
        },
      });
    }
    productId = (
      await prisma.product.findUniqueOrThrow({ where: { sku: 'LO-1' } })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Truy vấn lặp lại dùng cache', () => {
    it('chi tiết: lần 1 MISS, các lần sau HIT và KHÔNG truy vấn DB', async () => {
      const spy = jest.spyOn(repo, 'findById');

      const first = await detail().expect(200);
      const second = await detail().expect(200);
      const third = await detail().expect(200);

      expect(first.headers['x-cache']).toBe('MISS');
      expect(second.headers['x-cache']).toBe('HIT');
      expect(third.headers['x-cache']).toBe('HIT');
      expect(second.body).toEqual(first.body);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('danh mục có bộ lọc: lần 2 HIT, không truy vấn DB', async () => {
      const findMany = jest.spyOn(repo, 'findMany');
      const findByIds = jest.spyOn(repo, 'findManyByIds');

      await http().get(listUrl()).expect(200);
      const second = await http().get(listUrl()).expect(200);

      expect(second.headers['x-cache']).toBe('HIT');
      expect(second.body.items.map((p: { sku: string }) => p.sku)).toEqual([
        'LO-1',
        'LO-2',
      ]);
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(findByIds).not.toHaveBeenCalled(); // chi tiết đã được làm "ấm" từ lần 1
    });

    it('id không tồn tại: lần 2 bị chặn ở cache, không truy vấn DB (chống dò khoá)', async () => {
      const spy = jest.spyOn(repo, 'findById');
      const ghost = randomUUID();

      await detail(ghost).expect(404);
      await detail(ghost).expect(404);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(await redis.get(`product:${ghost}`)).toBe('__NULL__');
    });
  });

  describe('Làm mới cache khi giá / tồn kho đổi (khách không thấy giá cũ)', () => {
    it('admin đổi giá → chi tiết VÀ danh sách hiển thị giá mới ngay', async () => {
      await detail().expect(200);
      await http().get(listUrl()).expect(200); // cả 2 đã nằm trong cache

      await http()
        .patch(`/api/products/${productId}`)
        .set(auth(admin))
        .send({ price: 3_000_000 })
        .expect(200);

      const d = await detail().expect(200);
      expect(d.body.price).toBe(3_000_000);
      const l = await http().get(listUrl()).expect(200);
      // giá mới + thứ tự sắp xếp theo giá cũng đúng
      expect(
        l.body.items.map((p: { sku: string; price: number }) => [
          p.sku,
          p.price,
        ]),
      ).toEqual([
        ['LO-2', 2_000_000],
        ['LO-1', 3_000_000],
      ]);
    });

    it('khách đặt đơn → tồn kho trong cache được cập nhật ngay', async () => {
      expect((await detail().expect(200)).body.stock).toBe(10);

      await http()
        .post('/api/cart/items')
        .set(auth(customer))
        .send({ productId, quantity: 3 })
        .expect(201);
      await http()
        .post('/api/orders')
        .set(auth(customer))
        .set('Idempotency-Key', randomUUID())
        .send({
          paymentMethod: 'COD',
          shippingAddress: {
            fullName: 'Khách',
            phone: '0912345678',
            addressLine: '1 Lê Lợi',
            city: 'Hà Nội',
          },
        })
        .expect(201);

      expect((await detail().expect(200)).body.stock).toBe(7);
    });

    it('kho nhập hàng → tồn kho mới hiện ngay', async () => {
      await detail().expect(200);
      await http()
        .post('/api/inventory/adjustments')
        .set(auth(warehouse))
        .send({ productId, delta: 5 })
        .expect(201);
      expect((await detail().expect(200)).body.stock).toBe(15);
    });

    it('ngừng bán → biến mất khỏi danh sách và chi tiết dù đang được cache', async () => {
      await detail().expect(200);
      await http().get(listUrl()).expect(200);

      await http()
        .delete(`/api/products/${productId}`)
        .set(auth(admin))
        .expect(204);

      await detail().expect(404);
      const l = await http().get(listUrl()).expect(200);
      expect(l.body.items.map((p: { sku: string }) => p.sku)).toEqual(['LO-2']);
    });

    it('đổi tên danh mục → tên mới hiện trong chi tiết sản phẩm', async () => {
      await detail().expect(200);
      await http()
        .patch(`/api/categories/${categoryId}`)
        .set(auth(admin))
        .send({ name: 'Loa Bluetooth' })
        .expect(200);
      expect((await detail().expect(200)).body.category.name).toBe(
        'Loa Bluetooth',
      );
    });
  });

  describe('Redis hỏng', () => {
    it('vẫn xem được chi tiết và danh sách (BYPASS, đọc thẳng DB)', async () => {
      const down = () => Promise.reject(new Error('Redis down (giả lập)'));
      jest.spyOn(redis, 'get').mockImplementation(down);
      jest.spyOn(redis, 'mget').mockImplementation(down);
      jest.spyOn(redis, 'set').mockImplementation(down);

      const d = await detail().expect(200);
      expect(d.headers['x-cache']).toBe('BYPASS');
      expect(d.body.price).toBe(1_000_000);

      const l = await http().get(listUrl()).expect(200);
      expect(l.headers['x-cache']).toBe('BYPASS');
      expect(l.body.total).toBe(2);

      await http().get('/api/categories').expect(200);
    });
  });

  describe('Chỉ số cache', () => {
    it('ADMIN xem được hit/miss/hitRatio; khách → 403', async () => {
      await http()
        .delete('/api/admin/metrics/cache')
        .set(auth(admin))
        .expect(204);
      await detail();
      await detail();
      await detail();

      const res = await http()
        .get('/api/admin/metrics/cache')
        .set(auth(admin))
        .expect(200);
      expect(res.body).toMatchObject({ hits: 2, misses: 1 });
      expect(res.body.hitRatio).toBeCloseTo(0.6667, 3);

      await http()
        .get('/api/admin/metrics/cache')
        .set(auth(customer))
        .expect(403);
    });
  });
});
