import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, loginAs, resetDatabase } from './utils';

/**
 * Integration test cho giỏ hàng, đặt đơn, trạng thái đơn và tồn kho (F06.2, F06.3).
 * Chạy trên PostgreSQL THẬT để kiểm tra transaction và tranh chấp đồng thời.
 */
describe('Cart, Orders & Inventory (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  let customerA: string;
  let customerB: string;
  let warehouse: string;
  let scarceId: string; // tồn kho 1
  let plentyId: string; // tồn kho 50

  const address = {
    fullName: 'Nguyễn Văn A',
    phone: '0912345678',
    addressLine: '1 Lê Lợi, Quận 1',
    city: 'TP. Hồ Chí Minh',
  };
  const orderBody = (paymentMethod = 'COD') => ({
    paymentMethod,
    shippingAddress: address,
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const addToCart = (token: string, productId: string, quantity = 1) =>
    http()
      .post('/api/cart/items')
      .set(auth(token))
      .send({ productId, quantity });
  const placeOrder = (
    token: string,
    key: string = randomUUID(),
    body: object = orderBody(),
    path = '/api/orders',
  ) =>
    http().post(path).set(auth(token)).set('Idempotency-Key', key).send(body);
  const stockOf = async (id: string) =>
    (await prisma.product.findUniqueOrThrow({ where: { id } })).stock;

  async function newCustomerToken(email: string) {
    const user = await createUser(prisma, Role.CUSTOMER, email);
    return (await loginAs(app, user.email)).accessToken;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    customerA = await newCustomerToken('a@example.com');
    customerB = await newCustomerToken('b@example.com');
    const wh = await createUser(
      prisma,
      Role.WAREHOUSE_STAFF,
      'kho@example.com',
    );
    warehouse = (await loginAs(app, wh.email)).accessToken;

    const category = await prisma.category.create({
      data: { name: 'Tai nghe', slug: 'tai-nghe' },
    });
    const brand = await prisma.brand.create({
      data: { name: 'Sony', slug: 'sony' },
    });
    const base = { categoryId: category.id, brandId: brand.id };
    scarceId = (
      await prisma.product.create({
        data: {
          ...base,
          sku: 'TN-1',
          name: 'Tai nghe hiếm',
          slug: 'tn-1',
          price: 100_000,
          stock: 1,
        },
      })
    ).id;
    plentyId = (
      await prisma.product.create({
        data: {
          ...base,
          sku: 'TN-2',
          name: 'Tai nghe phổ thông',
          slug: 'tn-2',
          price: 200_000,
          stock: 50,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Giỏ hàng', () => {
    it('thêm (cộng dồn), sửa, xoá; tổng tiền tính theo giá hiện tại', async () => {
      await addToCart(customerA, plentyId, 2).expect(201);
      const added = await addToCart(customerA, plentyId, 1).expect(201);
      expect(added.body.items[0].quantity).toBe(3);

      const updated = await http()
        .patch(`/api/cart/items/${plentyId}`)
        .set(auth(customerA))
        .send({ quantity: 5 })
        .expect(200);
      expect(updated.body).toMatchObject({
        itemCount: 5,
        subtotal: 1_000_000,
        canCheckout: true,
      });

      const removed = await http()
        .delete(`/api/cart/items/${plentyId}`)
        .set(auth(customerA))
        .expect(200);
      expect(removed.body.items).toHaveLength(0);
    });

    it('thêm vượt tồn kho → 409; nhân viên kho không có giỏ hàng → 403', async () => {
      const res = await addToCart(customerA, scarceId, 2).expect(409);
      expect(res.body.message).toBe('"Tai nghe hiếm" chỉ còn 1 sản phẩm');

      await http().get('/api/cart').set(auth(warehouse)).expect(403);
    });

    it('giỏ của mỗi khách là riêng biệt', async () => {
      await addToCart(customerA, plentyId, 2).expect(201);
      const cartB = await http().get('/api/cart').set(auth(customerB));
      expect(cartB.body.items).toHaveLength(0);
    });
  });

  describe('Đặt đơn', () => {
    it('201: trừ kho, lưu bản chụp giá, ghi lịch sử + nhật ký kho, xoá giỏ', async () => {
      await addToCart(customerA, plentyId, 2).expect(201);

      const res = await placeOrder(customerA).expect(201);

      expect(res.body).toMatchObject({
        status: 'PENDING',
        paymentStatus: 'UNPAID',
        subtotal: 400_000,
        discount: 0,
        total: 400_000,
        items: [{ productId: plentyId, unitPrice: 200_000, quantity: 2 }],
      });
      expect(res.body.code).toMatch(/^SF-\d{8}-[0-9A-F]{8}$/);
      expect(res.body.statusHistory).toHaveLength(1);
      expect(await stockOf(plentyId)).toBe(48);

      const movement = await prisma.inventoryMovement.findFirstOrThrow({
        where: { orderId: res.body.id },
      });
      expect(movement).toMatchObject({
        delta: -2,
        stockAfter: 48,
        reason: 'ORDER',
      });

      const cart = await http().get('/api/cart').set(auth(customerA));
      expect(cart.body.items).toHaveLength(0);
    });

    it('đổi giá sau khi đặt KHÔNG làm thay đổi đơn cũ', async () => {
      await addToCart(customerA, plentyId, 1).expect(201);
      const res = await placeOrder(customerA).expect(201);

      await prisma.product.update({
        where: { id: plentyId },
        data: { price: 999_000 },
      });

      const order = await http()
        .get(`/api/orders/${res.body.id}`)
        .set(auth(customerA))
        .expect(200);
      expect(order.body.items[0].unitPrice).toBe(200_000);
      expect(order.body.total).toBe(200_000);
    });

    it('400: thiếu Idempotency-Key, giỏ trống, địa chỉ sai', async () => {
      await http()
        .post('/api/orders')
        .set(auth(customerA))
        .send(orderBody())
        .expect(400);

      const empty = await placeOrder(customerA).expect(400);
      expect(empty.body.message).toBe('Giỏ hàng đang trống');

      await addToCart(customerA, plentyId, 1).expect(201);
      await placeOrder(customerA, randomUUID(), {
        paymentMethod: 'COD',
        shippingAddress: { ...address, phone: '123' },
      }).expect(400);
    });

    it('cùng Idempotency-Key gửi 2 lần → chỉ 1 đơn, chỉ trừ kho 1 lần', async () => {
      await addToCart(customerA, plentyId, 2).expect(201);
      const key = randomUUID();

      const first = await placeOrder(customerA, key).expect(201);
      const second = await placeOrder(customerA, key).expect(200);

      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body.id).toBe(first.body.id);
      expect(await prisma.order.count()).toBe(1);
      expect(await stockOf(plentyId)).toBe(48);
    });

    it('cùng Idempotency-Key gửi ĐỒNG THỜI → vẫn chỉ 1 đơn', async () => {
      await addToCart(customerA, plentyId, 2).expect(201);
      const key = randomUUID();

      const results = await Promise.all([
        placeOrder(customerA, key),
        placeOrder(customerA, key),
        placeOrder(customerA, key),
      ]);

      // MỌI request đều thành công (1 cái tạo đơn 201, các cái còn lại nhận lại đơn đó 200)
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
      const ids = new Set(results.map((r) => r.body.id));
      expect(ids.size).toBe(1);
      expect(await prisma.order.count()).toBe(1);
      expect(await stockOf(plentyId)).toBe(48);
    });

    it('CHỐNG BÁN VƯỢT: 8 khách cùng lúc mua sản phẩm còn 3 → đúng 3 đơn thành công', async () => {
      await prisma.product.update({
        where: { id: scarceId },
        data: { stock: 3 },
      });
      const tokens = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          newCustomerToken(`buyer${i}@example.com`),
        ),
      );
      for (const token of tokens) {
        await addToCart(token, scarceId, 1).expect(201);
      }

      const results = await Promise.all(tokens.map((t) => placeOrder(t)));

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 201, 201, 409, 409, 409, 409, 409]);
      expect(await stockOf(scarceId)).toBe(0);
      expect(await prisma.order.count()).toBe(3);
      const rejected = results.find((r) => r.status === 409)!;
      expect(rejected.body).toMatchObject({
        code: 'OUT_OF_STOCK',
        message: '"Tai nghe hiếm" đã hết hàng',
      });
    });
  });

  describe('Lịch sử & quyền xem đơn', () => {
    it('khách chỉ thấy đơn của mình; xem đơn người khác → 404; nhân viên xem được', async () => {
      await addToCart(customerA, plentyId, 1).expect(201);
      const orderA = await placeOrder(customerA).expect(201);

      const mineA = await http().get('/api/orders/me').set(auth(customerA));
      const mineB = await http().get('/api/orders/me').set(auth(customerB));
      expect(mineA.body.total).toBe(1);
      expect(mineB.body.total).toBe(0);

      await http()
        .get(`/api/orders/${orderA.body.id}`)
        .set(auth(customerB))
        .expect(404);
      await http()
        .get(`/api/orders/${orderA.body.id}`)
        .set(auth(warehouse))
        .expect(200);

      await http().get('/api/orders').set(auth(customerA)).expect(403);
      const all = await http().get('/api/orders').set(auth(warehouse));
      expect(all.body.total).toBe(1);
    });
  });

  describe('Trạng thái đơn (kho)', () => {
    const setStatus = (token: string, id: string, status: string) =>
      http()
        .patch(`/api/orders/${id}/status`)
        .set(auth(token))
        .send({ status });

    it('đi đủ vòng đời PENDING → DELIVERED; COD tự thành PAID khi giao', async () => {
      await addToCart(customerA, plentyId, 1).expect(201);
      const { id } = (await placeOrder(customerA).expect(201)).body;

      for (const status of ['CONFIRMED', 'PACKING', 'SHIPPING']) {
        await setStatus(warehouse, id, status).expect(200);
      }
      const delivered = await setStatus(warehouse, id, 'DELIVERED').expect(200);

      expect(delivered.body).toMatchObject({
        status: 'DELIVERED',
        paymentStatus: 'PAID',
      });
      expect(delivered.body.statusHistory.map((h: any) => h.toStatus)).toEqual([
        'PENDING',
        'CONFIRMED',
        'PACKING',
        'SHIPPING',
        'DELIVERED',
      ]);
    });

    it('nhảy bước → 409; khách tự đổi trạng thái → 403', async () => {
      await addToCart(customerA, plentyId, 1).expect(201);
      const { id } = (await placeOrder(customerA).expect(201)).body;

      const res = await setStatus(warehouse, id, 'SHIPPING').expect(409);
      expect(res.body.message).toBe(
        'Không thể chuyển đơn từ "Chờ xác nhận" sang "Đang giao"',
      );
      await setStatus(customerA, id, 'CONFIRMED').expect(403);
    });

    it('huỷ đơn → hoàn lại tồn kho + ghi nhật ký CANCEL; huỷ lần 2 → 409', async () => {
      await addToCart(customerA, plentyId, 5).expect(201);
      const { id } = (await placeOrder(customerA).expect(201)).body;
      expect(await stockOf(plentyId)).toBe(45);

      const cancelled = await http()
        .post(`/api/orders/${id}/cancel`)
        .set(auth(customerA))
        .expect(201);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(await stockOf(plentyId)).toBe(50);
      expect(
        await prisma.inventoryMovement.count({
          where: { orderId: id, reason: 'CANCEL', delta: 5 },
        }),
      ).toBe(1);

      await http()
        .post(`/api/orders/${id}/cancel`)
        .set(auth(customerA))
        .expect(409);
    });

    it('thanh toán giả lập: kho không xác nhận đơn online chưa trả tiền; khách trả → CONFIRMED + PAID', async () => {
      await addToCart(customerA, plentyId, 1).expect(201);
      const { id } = (
        await placeOrder(customerA, randomUUID(), orderBody('MOCK_ONLINE'))
      ).body;

      await setStatus(warehouse, id, 'CONFIRMED').expect(409);

      const paid = await http()
        .post(`/api/orders/${id}/pay`)
        .set(auth(customerA))
        .expect(201);
      expect(paid.body).toMatchObject({
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
      });

      await http()
        .post(`/api/orders/${id}/pay`)
        .set(auth(customerA))
        .expect(409);
    });
  });

  describe('Đơn khuyến mãi', () => {
    beforeEach(async () => {
      await prisma.promotion.create({
        data: {
          code: 'GIAM10',
          discountPercent: 10,
          maxDiscount: 15_000,
          maxUses: 2,
          perUserLimit: 1,
          startsAt: new Date(Date.now() - 60_000),
          endsAt: new Date(Date.now() + 3_600_000),
        },
      });
    });

    const promoOrder = (token: string, code = 'giam10') =>
      placeOrder(
        token,
        randomUUID(),
        { ...orderBody(), promotionCode: code },
        '/api/orders/promotional',
      );

    it('giảm giá đúng (có trần); mỗi khách 1 lượt; hết tổng lượt → 409', async () => {
      await addToCart(customerA, plentyId, 1).expect(201);
      const first = await promoOrder(customerA).expect(201);
      expect(first.body).toMatchObject({
        subtotal: 200_000,
        discount: 15_000, // 10% = 20.000 nhưng trần 15.000
        total: 185_000,
        promotionCode: 'GIAM10',
      });

      await addToCart(customerA, plentyId, 1).expect(201);
      const again = await promoOrder(customerA).expect(409);
      expect(again.body.message).toBe(
        'Bạn đã dùng hết lượt cho mã khuyến mãi này',
      );

      await addToCart(customerB, plentyId, 1).expect(201);
      await promoOrder(customerB).expect(201);

      const customerC = await newCustomerToken('c@example.com');
      await addToCart(customerC, plentyId, 1).expect(201);
      const soldOut = await promoOrder(customerC).expect(409);
      expect(soldOut.body.message).toBe('Mã khuyến mãi đã hết lượt sử dụng');

      const promo = await prisma.promotion.findUniqueOrThrow({
        where: { code: 'GIAM10' },
      });
      expect(promo.usedCount).toBe(2);
    });

    it('1 khách gửi 2 đơn KM đồng thời → chỉ 1 đơn được giảm giá', async () => {
      await addToCart(customerA, plentyId, 1).expect(201);
      const results = await Promise.all([
        promoOrder(customerA),
        promoOrder(customerA),
      ]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(
        await prisma.order.count({ where: { promotionId: { not: null } } }),
      ).toBe(1);
    });

    it('mã không tồn tại → 404', async () => {
      await addToCart(customerA, plentyId, 1).expect(201);
      await promoOrder(customerA, 'KHONGCO').expect(404);
    });
  });

  describe('Tồn kho (nhân viên kho)', () => {
    it('nhập / xuất kho có ghi nhật ký; xuất quá tồn → 409; khách → 403', async () => {
      const added = await http()
        .post('/api/inventory/adjustments')
        .set(auth(warehouse))
        .send({ productId: scarceId, delta: 10, note: 'Nhập lô mới' })
        .expect(201);
      expect(added.body.product.stock).toBe(11);

      const tooMuch = await http()
        .post('/api/inventory/adjustments')
        .set(auth(warehouse))
        .send({ productId: scarceId, delta: -100 })
        .expect(409);
      expect(tooMuch.body.message).toContain('hiện chỉ còn 11 sản phẩm');

      await http()
        .post('/api/inventory/adjustments')
        .set(auth(customerA))
        .send({ productId: scarceId, delta: 10 })
        .expect(403);

      const history = await http()
        .get(`/api/inventory/products/${scarceId}/movements`)
        .set(auth(warehouse))
        .expect(200);
      expect(history.body.items[0]).toMatchObject({
        delta: 10,
        stockAfter: 11,
        reason: 'MANUAL_ADJUST',
        note: 'Nhập lô mới',
      });

      const low = await http()
        .get('/api/inventory/low-stock?threshold=20')
        .set(auth(warehouse))
        .expect(200);
      expect(low.body.items.map((p: any) => p.sku)).toEqual(['TN-1']);
    });
  });
});
