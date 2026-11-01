import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AppConfigModule } from '../src/config/app-config.module';
import { JobDataRepository } from '../src/jobs/job-data.repository';
import { JobsProducer } from '../src/jobs/jobs.producer';
import { OutboxDispatcher } from '../src/jobs/outbox.dispatcher';
import { ALL_QUEUES, jobIds, QUEUES } from '../src/jobs/queues';
import { InvoiceService } from '../src/jobs/services/invoice.service';
import { OrderNotificationsService } from '../src/jobs/services/order-notifications.service';
import { RevenueReportService } from '../src/jobs/services/revenue-report.service';
import { MailModule } from '../src/mail/mail.module';
import { MailerService } from '../src/mail/mailer.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, loginAs, resetDatabase } from './utils';

/**
 * Integration test cho F05 trên PostgreSQL + Redis THẬT.
 * Không chạy worker nền (để kết quả xác định được): kiểm tra job được đưa vào hàng đợi đúng,
 * và gọi trực tiếp các service của worker để kiểm tra tính idempotent.
 */
describe('Background jobs (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queues: Record<string, Queue>;
  const http = () => request(app.getHttpServer());

  let customer: string;
  let admin: string;
  let productId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const body = (paymentMethod = 'COD') => ({
    paymentMethod,
    shippingAddress: {
      fullName: 'Khách Test',
      phone: '0912345678',
      addressLine: '1 Lê Lợi',
      city: 'Hà Nội',
    },
  });

  async function placeOrder(paymentMethod = 'COD', target = app) {
    await request(target.getHttpServer())
      .post('/api/cart/items')
      .set(auth(customer))
      .send({ productId, quantity: 1 })
      .expect(201);
    const res = await request(target.getHttpServer())
      .post('/api/orders')
      .set(auth(customer))
      .set('Idempotency-Key', randomUUID())
      .send(body(paymentMethod))
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    queues = Object.fromEntries(
      ALL_QUEUES.map((name) => [name, app.get<Queue>(getQueueToken(name))]),
    );
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await Promise.all(
      Object.values(queues).map((q) => q.obliterate({ force: true })),
    );
    const c = await createUser(prisma, Role.CUSTOMER, 'khach@example.com');
    const a = await createUser(prisma, Role.ADMIN, 'admin@example.com');
    customer = (await loginAs(app, c.email)).accessToken;
    admin = (await loginAs(app, a.email)).accessToken;
    const category = await prisma.category.create({
      data: { name: 'Loa', slug: 'loa' },
    });
    const brand = await prisma.brand.create({
      data: { name: 'JBL', slug: 'jbl' },
    });
    productId = (
      await prisma.product.create({
        data: {
          sku: 'LO-1',
          name: 'Loa JBL',
          slug: 'lo-1',
          price: 500_000,
          stock: 100,
          categoryId: category.id,
          brandId: brand.id,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Đặt đơn → đưa job vào hàng đợi (không chờ job chạy)', () => {
    it('COD: outbox đã đẩy; có job email, hoá đơn, đồng bộ kho với jobId theo đơn', async () => {
      const orderId = await placeOrder('COD');

      const outbox = await prisma.jobOutbox.findFirstOrThrow({
        where: { orderId },
      });
      expect(outbox.dispatchedAt).not.toBeNull();

      const email = await queues[QUEUES.EMAIL].getJob(
        jobIds.orderConfirmation(orderId),
      );
      expect(email?.data).toEqual({ orderId });
      expect(email?.opts.attempts).toBe(5);
      expect(
        await queues[QUEUES.INVOICE].getJob(jobIds.invoice(orderId)),
      ).toBeDefined();
      expect(
        await queues[QUEUES.INVENTORY_SYNC].getJob(
          jobIds.inventorySync(orderId, 'placed'),
        ),
      ).toBeDefined();
      // COD không cần nhắc thanh toán
      expect(
        await queues[QUEUES.EMAIL].getJob(jobIds.paymentReminder(orderId)),
      ).toBeUndefined();
    });

    it('MOCK_ONLINE: có job nhắc thanh toán ở trạng thái hẹn giờ (delayed)', async () => {
      const orderId = await placeOrder('MOCK_ONLINE');
      const reminder = await queues[QUEUES.EMAIL].getJob(
        jobIds.paymentReminder(orderId),
      );
      expect(await reminder?.getState()).toBe('delayed');
      expect(reminder?.opts.delay).toBe(30 * 60 * 1000);
    });

    it('huỷ đơn → thêm job đồng bộ kho "cancelled"', async () => {
      const orderId = await placeOrder('COD');
      await http()
        .post(`/api/orders/${orderId}/cancel`)
        .set(auth(customer))
        .expect(201);
      expect(
        await queues[QUEUES.INVENTORY_SYNC].getJob(
          jobIds.inventorySync(orderId, 'cancelled'),
        ),
      ).toBeDefined();
    });

    it('đẩy cùng sự kiện 3 lần → hàng đợi vẫn chỉ có 1 job email cho đơn đó', async () => {
      const orderId = await placeOrder('COD');
      const producer = app.get(JobsProducer);
      await producer.orderPlaced(orderId, 'COD');
      await producer.orderPlaced(orderId, 'COD');

      const counts = await queues[QUEUES.EMAIL].getJobCounts('waiting');
      expect(counts.waiting).toBe(1);
    });
  });

  describe('Hàng đợi hỏng lúc đặt đơn (transactional outbox)', () => {
    let brokenApp: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(JobsProducer)
        .useValue({
          orderPlaced: () => Promise.reject(new Error('Redis down (giả lập)')),
          orderCancelled: () =>
            Promise.reject(new Error('Redis down (giả lập)')),
        })
        .compile();
      brokenApp = configureApp(moduleRef.createNestApplication());
      await brokenApp.init();
    });

    afterAll(async () => {
      await brokenApp.close();
    });

    it('đơn vẫn tạo thành công; sự kiện nằm chờ trong outbox; job quét đẩy lại được', async () => {
      const orderId = await placeOrder('COD', brokenApp);

      const pending = await prisma.jobOutbox.findFirstOrThrow({
        where: { orderId },
      });
      expect(pending).toMatchObject({ dispatchedAt: null, attempts: 1 });
      expect(pending.lastError).toContain('Redis down');

      // Redis "sống lại": job outbox-sweep của worker gọi dispatchStale()
      const result = await app.get(OutboxDispatcher).dispatchStale(0);
      expect(result).toEqual({ dispatched: 1, failed: 0 });
      expect(
        await queues[QUEUES.EMAIL].getJob(jobIds.orderConfirmation(orderId)),
      ).toBeDefined();
    });
  });

  describe('Service của worker: chạy lại không gây tác dụng phụ nhân đôi', () => {
    let worker: INestApplication;
    const sent: string[] = [];

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppConfigModule, PrismaModule, MailModule],
        providers: [
          JobDataRepository,
          OrderNotificationsService,
          InvoiceService,
          RevenueReportService,
        ],
      })
        .overrideProvider(MailerService)
        .useValue({
          send: async (m: { to: string; subject: string }) => {
            sent.push(`${m.to}|${m.subject}`);
            return { messageId: `m${sent.length}` };
          },
        })
        .compile();
      worker = moduleRef.createNestApplication();
      await worker.init();
    });

    beforeEach(() => {
      sent.length = 0;
    });

    afterAll(async () => {
      await worker.close();
    });

    it('email xác nhận: 5 worker song song + 1 lần retry → khách nhận ĐÚNG 1 email', async () => {
      const orderId = await placeOrder('COD');
      const notifications = worker.get(OrderNotificationsService);

      // 5 worker cùng gửi ĐỒNG THỜI: đúng 1 worker gửi; số còn lại hoặc thấy SENT,
      // hoặc nhận lỗi "đang được worker khác gửi" (BullMQ sẽ thử lại sau).
      const parallel = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          notifications.sendOrderConfirmation(orderId),
        ),
      );
      const sentCount = parallel.filter(
        (r) => r.status === 'fulfilled' && r.value === 'sent',
      ).length;
      expect(sentCount).toBe(1);

      // Lần chạy lại sau đó (retry) → bỏ qua vì đã SENT
      await expect(notifications.sendOrderConfirmation(orderId)).resolves.toBe(
        'already-sent',
      );

      expect(sent).toHaveLength(1);
      expect(await prisma.emailLog.count({ where: { orderId } })).toBe(1);
    });

    it('hoá đơn: 3 worker tạo cùng lúc → đúng 1 hoá đơn', async () => {
      const orderId = await placeOrder('COD');
      const invoices = worker.get(InvoiceService);

      await Promise.all([
        invoices.generate(orderId),
        invoices.generate(orderId),
        invoices.generate(orderId),
      ]);

      expect(await prisma.invoice.count({ where: { orderId } })).toBe(1);
      const res = await http()
        .get(`/api/orders/${orderId}/invoice`)
        .set(auth(customer))
        .expect(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('HOÁ ĐƠN BÁN HÀNG');
    });

    it('nhắc thanh toán: đơn đã thanh toán thì không gửi', async () => {
      const orderId = await placeOrder('MOCK_ONLINE');
      await http().post(`/api/orders/${orderId}/pay`).set(auth(customer));

      await expect(
        worker.get(OrderNotificationsService).sendPaymentReminder(orderId),
      ).resolves.toBe('skipped');
      expect(sent).toHaveLength(0);
    });

    it('báo cáo doanh thu: chạy 2 lần → 1 bản ghi/ngày, admin nhận 1 email', async () => {
      await placeOrder('COD');
      await placeOrder('COD');
      const reports = worker.get(RevenueReportService);

      const first = await reports.generate();
      await reports.generate();

      expect(first).toMatchObject({ orderCount: 2, revenue: '1000000' });
      expect(await prisma.dailyRevenueReport.count()).toBe(1);
      expect(sent.filter((s) => s.startsWith('admin@'))).toHaveLength(1);
    });
  });

  describe('API quản trị hàng đợi', () => {
    it('GET /api/admin/queues: ADMIN thấy số liệu 4 hàng đợi; khách → 403', async () => {
      await placeOrder('COD');
      const res = await http()
        .get('/api/admin/queues')
        .set(auth(admin))
        .expect(200);
      expect(res.body.queues.map((q: { name: string }) => q.name)).toEqual(
        ALL_QUEUES,
      );
      const email = res.body.queues.find(
        (q: { name: string }) => q.name === 'email',
      );
      expect(email.waiting).toBe(1);
      expect(res.body.outboxPending).toBe(0);

      await http().get('/api/admin/queues').set(auth(customer)).expect(403);
    });

    it('dead letter: xem danh sách và chạy lại job lỗi', async () => {
      const failed = await prisma.failedJob.create({
        data: {
          queue: 'email',
          jobId: 'order-confirmation-x',
          jobName: 'order-confirmation',
          payload: { orderId: randomUUID() },
          failedReason: 'SMTP timeout',
          attemptsMade: 5,
        },
      });

      const list = await http()
        .get('/api/admin/jobs/failed?queue=email')
        .set(auth(admin))
        .expect(200);
      expect(list.body.items[0]).toMatchObject({
        failedReason: 'SMTP timeout',
        attemptsMade: 5,
      });

      const retried = await http()
        .post(`/api/admin/jobs/failed/${failed.id}/retry`)
        .set(auth(admin))
        .expect(202);
      expect(
        await queues[QUEUES.EMAIL].getJob(retried.body.jobId),
      ).toBeDefined();
      expect(
        (await prisma.failedJob.findUniqueOrThrow({ where: { id: failed.id } }))
          .retriedAt,
      ).not.toBeNull();
    });

    it('kích hoạt báo cáo doanh thu thủ công; ngày sai định dạng → 400', async () => {
      const res = await http()
        .post('/api/admin/reports/daily-revenue')
        .set(auth(admin))
        .send({ date: '2026-11-01' })
        .expect(202);
      expect(
        await queues[QUEUES.SCHEDULED].getJob(res.body.jobId),
      ).toBeDefined();

      await http()
        .post('/api/admin/reports/daily-revenue')
        .set(auth(admin))
        .send({ date: '01-11-2026' })
        .expect(400);
    });
  });
});
