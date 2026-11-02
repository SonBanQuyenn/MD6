import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io, Socket } from 'socket.io-client';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrdersGateway } from '../src/realtime/orders.gateway';
import { createTestApp, createUser, loginAs, resetDatabase } from './utils';

/**
 * Integration test F02 — Socket.IO THẬT (app.listen trên cổng ngẫu nhiên, socket.io-client thật).
 */
describe('Realtime order tracking (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const sockets: Socket[] = [];
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let tokenA: string;
  let tokenB: string;
  let warehouseToken: string;
  let orderA: string;
  let orderB: string;

  /** Tạo kết nối Socket.IO; mặc định không tự kết nối lại để test lỗi rõ ràng. */
  function connect(token?: string, reconnection = false): Socket {
    const socket = io(baseUrl, {
      path: '/api/socket.io',
      transports: ['websocket'],
      auth: token ? { token } : {},
      reconnection,
      reconnectionDelay: 100,
      reconnectionDelayMax: 200,
      forceNew: true,
    });
    sockets.push(socket);
    return socket;
  }

  const waitFor = <T>(socket: Socket, event: string, ms = 3000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Hết giờ chờ sự kiện "${event}"`)),
        ms,
      );
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  const subscribe = (socket: Socket, orderId: string) =>
    socket.emitWithAck('order:subscribe', { orderId });

  const setStatus = (orderId: string, status: string) =>
    http()
      .patch(`/api/orders/${orderId}/status`)
      .set(auth(warehouseToken))
      .send({ status })
      .expect(200);

  async function placeOrder(token: string, productId: string) {
    await http()
      .post('/api/cart/items')
      .set(auth(token))
      .send({ productId, quantity: 1 })
      .expect(201);
    const res = await http()
      .post('/api/orders')
      .set(auth(token))
      .set('Idempotency-Key', randomUUID())
      .send({
        paymentMethod: 'COD',
        shippingAddress: {
          fullName: 'Nguyễn Văn A',
          phone: '0912345678',
          addressLine: '1 Lê Lợi',
          city: 'Hà Nội',
        },
      })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const [a, b, wh] = await Promise.all([
      createUser(prisma, Role.CUSTOMER, 'a@example.com'),
      createUser(prisma, Role.CUSTOMER, 'b@example.com'),
      createUser(prisma, Role.WAREHOUSE_STAFF, 'kho@example.com'),
    ]);
    tokenA = (await loginAs(app, a.email)).accessToken;
    tokenB = (await loginAs(app, b.email)).accessToken;
    warehouseToken = (await loginAs(app, wh.email)).accessToken;

    const category = await prisma.category.create({
      data: { name: 'Loa', slug: 'loa' },
    });
    const brand = await prisma.brand.create({
      data: { name: 'JBL', slug: 'jbl' },
    });
    const product = await prisma.product.create({
      data: {
        sku: 'LOA-1',
        name: 'Loa bluetooth',
        slug: 'loa-1',
        price: 500_000,
        stock: 10,
        categoryId: category.id,
        brandId: brand.id,
      },
    });
    orderA = await placeOrder(tokenA, product.id);
    orderB = await placeOrder(tokenB, product.id);
  });

  afterEach(() => {
    sockets.splice(0).forEach((s) => s.disconnect());
  });

  afterAll(async () => {
    await app.close();
  });

  it('không có token → bị từ chối ngay lúc bắt tay', async () => {
    const error = await waitFor<Error>(connect(), 'connect_error');
    expect(error.message).toBe('UNAUTHORIZED');
  });

  it('token sai → bị từ chối lúc bắt tay', async () => {
    const error = await waitFor<Error>(
      connect('khong-hop-le'),
      'connect_error',
    );
    expect(error.message).toBe('UNAUTHORIZED');
  });

  it('chủ đơn nhận cập nhật trạng thái ngay khi kho đổi (đo độ trễ < 1 giây)', async () => {
    const socket = connect(tokenA);
    await waitFor(socket, 'connect');
    await expect(subscribe(socket, orderA)).resolves.toEqual({
      ok: true,
      orderId: orderA,
      status: 'PENDING',
    });

    // Đi hết vòng đời đơn: mỗi lần kho đổi trạng thái, khách phải nhận sự kiện tương ứng.
    const latencies: number[] = [];
    for (const status of ['CONFIRMED', 'PACKING', 'SHIPPING', 'DELIVERED']) {
      const received = waitFor<{ orderId: string; status: string }>(
        socket,
        'order:status',
      );
      const startedAt = performance.now();
      await setStatus(orderA, status);
      const event = await received;
      latencies.push(performance.now() - startedAt);
      expect(event).toMatchObject({
        orderId: orderA,
        status,
        statusLabel: expect.any(String),
      });
    }
    // NFR-PERF-03: tính từ lúc gửi PATCH tới lúc client nhận sự kiện (gồm cả ghi DB)
    const max = Math.max(...latencies);
    process.stdout.write(
      `[NFR-PERF-03] độ trễ realtime (ms): ${latencies.map((l) => l.toFixed(1)).join(', ')} — max ${max.toFixed(1)}\n`,
    );
    expect(max).toBeLessThan(1000);
  });

  it('khách khác KHÔNG theo dõi được đơn không phải của mình', async () => {
    const socket = connect(tokenB);
    await waitFor(socket, 'connect');
    await expect(subscribe(socket, orderA)).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    await expect(subscribe(socket, randomUUID())).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    await expect(subscribe(socket, 'khong-phai-uuid')).resolves.toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  it('sự kiện đơn của A không lọt sang B (B đang theo dõi đơn của chính mình)', async () => {
    const socketA = connect(tokenA);
    const socketB = connect(tokenB);
    await Promise.all([
      waitFor(socketA, 'connect'),
      waitFor(socketB, 'connect'),
    ]);
    await subscribe(socketA, orderA);
    await subscribe(socketB, orderB);

    const leaked: unknown[] = [];
    socketB.on('order:status', (e) => leaked.push(e));
    const gotA = waitFor(socketA, 'order:status');
    await setStatus(orderA, 'CONFIRMED');
    await gotA;
    await new Promise((r) => setTimeout(r, 300)); // chờ thêm để chắc chắn B không nhận gì
    expect(leaked).toEqual([]);
  });

  it('nhân viên kho theo dõi được mọi đơn', async () => {
    const socket = connect(warehouseToken);
    await waitFor(socket, 'connect');
    await expect(subscribe(socket, orderA)).resolves.toMatchObject({
      ok: true,
    });
  });

  it('mất mạng → client tự kết nối lại, đăng ký lại và vẫn nhận sự kiện', async () => {
    const socket = connect(tokenA, true);
    // Giống frontend (useOrderTracking): MỖI lần kết nối (kể cả kết nối lại) đều đăng ký lại.
    let connects = 0;
    let firstSubscribed!: () => void;
    const subscribedOnce = new Promise<void>((r) => (firstSubscribed = r));
    const resubscribed = new Promise<void>((resolve) => {
      socket.on('connect', () => {
        connects += 1;
        subscribe(socket, orderA)
          .then((ack) => {
            expect(ack).toMatchObject({ ok: true });
            if (connects === 1) firstSubscribed();
            if (connects === 2) resolve();
          })
          .catch(() => undefined); // mất kết nối giữa chừng → lần kết nối sau sẽ đăng ký lại
      });
    });
    await subscribedOnce;

    // Giả lập rớt mạng: server đóng tầng truyền tải (không phải "disconnect" chủ động,
    // vì Socket.IO không tự kết nối lại khi server chủ động ngắt).
    const server = (app.get(OrdersGateway) as unknown as { server: Server })
      .server;
    server.sockets.sockets.forEach((s) => s.conn.close());

    await resubscribed;
    expect(connects).toBe(2);

    const received = waitFor<{ status: string }>(socket, 'order:status');
    await setStatus(orderA, 'CONFIRMED');
    await expect(received).resolves.toMatchObject({ status: 'CONFIRMED' });
  });
});
