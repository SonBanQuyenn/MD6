import { ConfigService } from '@nestjs/config';
import {
  JobOutbox,
  OrderStatus,
  OutboxEventType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import { EmailService } from '../mail/email.service';
import { FailedJobsRepository } from './failed-jobs.repository';
import { JobDataRepository, OrderForJobs } from './job-data.repository';
import { JobsProducer } from './jobs.producer';
import { OutboxDispatcher } from './outbox.dispatcher';
import { OutboxRepository } from './outbox.repository';
import { BaseProcessor, isFinalFailure } from './processors/base.processor';
import { jobIds } from './queues';
import { bullConnection } from './redis-connection';
import { InventorySyncService } from './services/inventory-sync.service';
import { invoiceNumber, InvoiceService } from './services/invoice.service';
import { OrderNotificationsService } from './services/order-notifications.service';
import { PartnerInventoryClient } from './services/partner-inventory.client';
import {
  RevenueReportService,
  summarize,
  vnDayRange,
  vnToday,
} from './services/revenue-report.service';

const order = (overrides: Partial<OrderForJobs> = {}): OrderForJobs =>
  ({
    id: 'o1',
    code: 'SF-20261101-ABCDEF12',
    status: OrderStatus.PENDING,
    paymentStatus: PaymentStatus.UNPAID,
    paymentMethod: PaymentMethod.MOCK_ONLINE,
    subtotal: 200_000,
    discount: 0,
    total: 200_000,
    shippingAddress: { fullName: 'A', phone: '0912345678' },
    createdAt: new Date(),
    items: [
      {
        productId: 'p1',
        productName: 'SP',
        sku: 'S1',
        unitPrice: 100_000,
        quantity: 2,
      },
    ],
    user: { email: 'k@example.com', fullName: 'Khách' },
    ...overrides,
  }) as OrderForJobs;

const prismaUnique = () =>
  new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('jobIds', () => {
  it('xác định theo nghiệp vụ và không chứa ":" (BullMQ cấm)', () => {
    const ids = [
      jobIds.orderConfirmation('o1'),
      jobIds.paymentReminder('o1'),
      jobIds.invoice('o1'),
      jobIds.inventorySync('o1', 'placed'),
    ];
    ids.forEach((id) => expect(id).not.toContain(':'));
    expect(jobIds.orderConfirmation('o1')).toBe(jobIds.orderConfirmation('o1'));
  });
});

describe('bullConnection', () => {
  it('đọc host/port/db/mật khẩu từ REDIS_URL', () => {
    expect(
      bullConnection('redis://:p%40ss@redis.local:6380/2', 'worker'),
    ).toMatchObject({
      host: 'redis.local',
      port: 6380,
      db: 2,
      password: 'p@ss',
      maxRetriesPerRequest: null,
    });
  });

  it('producer: tắt offline queue để Redis chết thì báo lỗi ngay', () => {
    expect(bullConnection('redis://localhost:6379', 'producer')).toMatchObject({
      enableOfflineQueue: false,
      db: 0,
    });
  });
});

describe('JobsProducer', () => {
  const makeQueue = () => ({ add: jest.fn().mockResolvedValue({}) });
  let email: ReturnType<typeof makeQueue>;
  let invoice: ReturnType<typeof makeQueue>;
  let sync: ReturnType<typeof makeQueue>;
  let producer: JobsProducer;

  beforeEach(() => {
    email = makeQueue();
    invoice = makeQueue();
    sync = makeQueue();
    producer = new JobsProducer(
      email as unknown as Queue,
      invoice as unknown as Queue,
      sync as unknown as Queue,
      { get: () => 1_800_000 } as unknown as ConfigService,
    );
  });

  it('đơn COD: email xác nhận + hoá đơn + đồng bộ kho, KHÔNG nhắc thanh toán', async () => {
    await producer.orderPlaced('o1', PaymentMethod.COD);

    expect(email.add).toHaveBeenCalledTimes(1);
    expect(email.add).toHaveBeenCalledWith(
      'order-confirmation',
      { orderId: 'o1' },
      expect.objectContaining({
        jobId: 'order-confirmation-o1',
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      }),
    );
    expect(invoice.add).toHaveBeenCalledTimes(1);
    expect(sync.add).toHaveBeenCalledWith(
      'sync-inventory',
      { orderId: 'o1', event: 'placed' },
      expect.objectContaining({ jobId: 'inventory-sync-o1-placed' }),
    );
  });

  it('đơn online: thêm job nhắc thanh toán hẹn giờ 30 phút', async () => {
    await producer.orderPlaced('o1', PaymentMethod.MOCK_ONLINE);

    expect(email.add).toHaveBeenCalledWith(
      'payment-reminder',
      { orderId: 'o1' },
      expect.objectContaining({
        jobId: 'payment-reminder-o1',
        delay: 1_800_000,
      }),
    );
  });
});

describe('OutboxDispatcher', () => {
  const event = (type: OutboxEventType): JobOutbox => ({
    id: 'e1',
    type,
    orderId: 'o1',
    payload: { paymentMethod: PaymentMethod.COD },
    dispatchedAt: null,
    attempts: 0,
    lastError: null,
    createdAt: new Date(),
  });
  let outbox: jest.Mocked<
    Pick<OutboxRepository, 'findPending' | 'markDispatched' | 'markFailed'>
  >;
  let producer: jest.Mocked<
    Pick<JobsProducer, 'orderPlaced' | 'orderCancelled'>
  >;
  let dispatcher: OutboxDispatcher;

  beforeEach(() => {
    outbox = {
      findPending: jest.fn(),
      markDispatched: jest.fn(),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    producer = {
      orderPlaced: jest.fn().mockResolvedValue(undefined),
      orderCancelled: jest.fn().mockResolvedValue(undefined),
    };
    dispatcher = new OutboxDispatcher(
      outbox as unknown as OutboxRepository,
      producer as unknown as JobsProducer,
    );
  });

  it('ORDER_PLACED → producer.orderPlaced rồi đánh dấu đã đẩy', async () => {
    outbox.findPending.mockResolvedValue([event(OutboxEventType.ORDER_PLACED)]);

    await expect(dispatcher.dispatchForOrder('o1')).resolves.toEqual({
      dispatched: 1,
      failed: 0,
    });
    expect(producer.orderPlaced).toHaveBeenCalledWith('o1', PaymentMethod.COD);
    expect(outbox.markDispatched).toHaveBeenCalledWith('e1');
  });

  it('ORDER_CANCELLED → producer.orderCancelled', async () => {
    outbox.findPending.mockResolvedValue([
      event(OutboxEventType.ORDER_CANCELLED),
    ]);
    await dispatcher.dispatchForOrder('o1');
    expect(producer.orderCancelled).toHaveBeenCalledWith('o1');
  });

  it('Redis lỗi → KHÔNG ném lỗi, giữ sự kiện để quét lại, ghi lý do', async () => {
    outbox.findPending.mockResolvedValue([event(OutboxEventType.ORDER_PLACED)]);
    producer.orderPlaced.mockRejectedValue(new Error('Redis down'));

    await expect(dispatcher.dispatchForOrder('o1')).resolves.toEqual({
      dispatched: 0,
      failed: 1,
    });
    expect(outbox.markDispatched).not.toHaveBeenCalled();
    expect(outbox.markFailed).toHaveBeenCalledWith('e1', 'Redis down');
  });

  it('DB lỗi khi đọc outbox → không ném lỗi', async () => {
    outbox.findPending.mockRejectedValue(new Error('DB down'));
    await expect(dispatcher.dispatchStale()).resolves.toEqual({
      dispatched: 0,
      failed: 0,
    });
  });
});

describe('Dead letter (BaseProcessor)', () => {
  const job = (attemptsMade: number, attempts = 5) =>
    ({
      id: 'j1',
      name: 'order-confirmation',
      queueName: 'email',
      data: { orderId: 'o1' },
      attemptsMade,
      opts: { attempts },
    }) as unknown as Job;

  it('isFinalFailure: còn lượt → false; hết lượt hoặc UnrecoverableError → true', () => {
    expect(isFinalFailure(job(2), new Error('x'))).toBe(false);
    expect(isFinalFailure(job(5), new Error('x'))).toBe(true);
    expect(isFinalFailure(job(1), new UnrecoverableError('x'))).toBe(true);
  });

  class TestProcessor extends BaseProcessor {
    process = jest.fn();
  }

  it('chỉ lưu vào failed_jobs ở lần thất bại CUỐI, kèm lý do', async () => {
    const repo = { record: jest.fn() };
    const processor = new TestProcessor(
      repo as unknown as FailedJobsRepository,
    );

    await processor.handleFailed(job(3), new Error('SMTP timeout'));
    expect(repo.record).not.toHaveBeenCalled();

    await processor.handleFailed(job(5), new Error('SMTP timeout'));
    expect(repo.record).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: 'email',
        jobId: 'j1',
        jobName: 'order-confirmation',
        payload: { orderId: 'o1' },
        failedReason: 'SMTP timeout',
        attemptsMade: 5,
      }),
    );
  });
});

describe('Job services', () => {
  let data: jest.Mocked<JobDataRepository>;
  let email: jest.Mocked<Pick<EmailService, 'sendOnce'>>;

  beforeEach(() => {
    data = {
      findOrder: jest.fn().mockResolvedValue(order()),
      findInvoiceByOrder: jest.fn().mockResolvedValue(null),
      createInvoice: jest.fn(),
      findSyncLog: jest.fn().mockResolvedValue(null),
      createSyncLog: jest.fn(),
      productStocks: jest
        .fn()
        .mockResolvedValue([{ id: 'p1', sku: 'S1', stock: 8 }]),
      revenueByStatus: jest.fn(),
      upsertDailyReport: jest.fn(),
      findActiveAdmins: jest.fn(),
    } as unknown as jest.Mocked<JobDataRepository>;
    email = { sendOnce: jest.fn().mockResolvedValue('sent') };
  });

  describe('OrderNotificationsService', () => {
    const service = () =>
      new OrderNotificationsService(data, email as unknown as EmailService);

    it('email xác nhận dùng dedupeKey theo đơn', async () => {
      await service().sendOrderConfirmation('o1');
      expect(email.sendOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          dedupeKey: 'order-confirmation-o1',
          to: 'k@example.com',
        }),
      );
    });

    it.each([
      ['đã thanh toán', { paymentStatus: PaymentStatus.PAID }],
      ['đã huỷ', { status: OrderStatus.CANCELLED }],
    ])('nhắc thanh toán: đơn %s → bỏ qua, không gửi', async (_l, o) => {
      data.findOrder.mockResolvedValue(order(o));
      await expect(service().sendPaymentReminder('o1')).resolves.toBe(
        'skipped',
      );
      expect(email.sendOnce).not.toHaveBeenCalled();
    });

    it('đơn không tồn tại → UnrecoverableError (không retry vô ích)', async () => {
      data.findOrder.mockResolvedValue(null);
      await expect(
        service().sendOrderConfirmation('o1'),
      ).rejects.toBeInstanceOf(UnrecoverableError);
    });
  });

  describe('InvoiceService', () => {
    it('số hoá đơn suy ra từ mã đơn', () => {
      expect(invoiceNumber('SF-20261101-ABCDEF12')).toBe(
        'INV-20261101-ABCDEF12',
      );
    });

    it('đã có hoá đơn → không tạo thêm', async () => {
      data.findInvoiceByOrder.mockResolvedValue({ id: 'i1' } as never);
      await expect(new InvoiceService(data).generate('o1')).resolves.toBe(
        'already-exists',
      );
      expect(data.createInvoice).not.toHaveBeenCalled();
    });

    it('2 worker tạo cùng lúc (UNIQUE) → coi như đã có', async () => {
      data.createInvoice.mockRejectedValue(prismaUnique());
      await expect(new InvoiceService(data).generate('o1')).resolves.toBe(
        'already-exists',
      );
    });

    it('tạo hoá đơn với tổng tiền của đơn', async () => {
      await new InvoiceService(data).generate('o1');
      expect(data.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          number: 'INV-20261101-ABCDEF12',
          total: 200_000,
          html: expect.stringContaining('HOÁ ĐƠN BÁN HÀNG'),
        }),
      );
    });
  });

  describe('InventorySyncService', () => {
    const partner = { pushStockLevels: jest.fn() };
    const service = () =>
      new InventorySyncService(
        data,
        partner as unknown as PartnerInventoryClient,
      );
    beforeEach(() => partner.pushStockLevels.mockReset());

    it('gửi MỨC tồn kho hiện tại kèm idempotency key, rồi ghi log', async () => {
      partner.pushStockLevels.mockResolvedValue({ partnerRef: 'REF1' });

      await expect(
        service().sync({ orderId: 'o1', event: 'placed' }),
      ).resolves.toBe('synced');
      expect(partner.pushStockLevels).toHaveBeenCalledWith(
        'inventory-sync-o1-placed',
        [{ sku: 'S1', stock: 8 }],
      );
      expect(data.createSyncLog).toHaveBeenCalled();
    });

    it('đã đồng bộ trước đó → không gọi đối tác', async () => {
      data.findSyncLog.mockResolvedValue({ id: 'l1' } as never);
      await expect(
        service().sync({ orderId: 'o1', event: 'placed' }),
      ).resolves.toBe('already-synced');
      expect(partner.pushStockLevels).not.toHaveBeenCalled();
    });

    it('đối tác lỗi → ném lỗi để BullMQ retry, không ghi log', async () => {
      partner.pushStockLevels.mockRejectedValue(new Error('503'));
      await expect(
        service().sync({ orderId: 'o1', event: 'placed' }),
      ).rejects.toThrow('503');
      expect(data.createSyncLog).not.toHaveBeenCalled();
    });
  });

  describe('Báo cáo doanh thu', () => {
    it('vnToday: 23:30 UTC ngày 31/10 = 06:30 ngày 01/11 giờ VN', () => {
      expect(vnToday(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
    });

    it('vnDayRange: 00:00 giờ VN = 17:00 UTC hôm trước', () => {
      const { from, to } = vnDayRange('2026-11-01');
      expect(from.toISOString()).toBe('2026-10-31T17:00:00.000Z');
      expect(to.toISOString()).toBe('2026-11-01T17:00:00.000Z');
      expect(() => vnDayRange('01/11/2026')).toThrow();
    });

    it('summarize: doanh thu không tính đơn huỷ; dùng BigInt', () => {
      const s = summarize([
        {
          status: OrderStatus.PENDING,
          _count: { _all: 2 },
          _sum: { total: 1_500_000_000 },
        },
        {
          status: OrderStatus.DELIVERED,
          _count: { _all: 1 },
          _sum: { total: 1_500_000_000 },
        },
        {
          status: OrderStatus.CANCELLED,
          _count: { _all: 4 },
          _sum: { total: 999 },
        },
      ]);
      expect(s).toMatchObject({
        orderCount: 3,
        cancelledCount: 4,
        revenue: 3_000_000_000n, // vượt giới hạn INTEGER — lý do dùng BigInt
      });
    });

    it('generate: upsert theo ngày + gửi mỗi admin 1 email chống trùng', async () => {
      data.revenueByStatus.mockResolvedValue([]);
      data.upsertDailyReport.mockResolvedValue({
        orderCount: 0,
        cancelledCount: 0,
        revenue: 0n,
      } as never);
      data.findActiveAdmins.mockResolvedValue([
        { id: 'a1', email: 'a1@x.com' },
        { id: 'a2', email: 'a2@x.com' },
      ]);

      const result = await new RevenueReportService(
        data,
        email as unknown as EmailService,
      ).generate('2026-11-01');

      expect(data.upsertDailyReport).toHaveBeenCalledWith(
        expect.objectContaining({
          reportDate: new Date('2026-11-01T00:00:00Z'),
        }),
      );
      expect(email.sendOnce).toHaveBeenCalledWith(
        expect.objectContaining({ dedupeKey: 'daily-report-2026-11-01-a1' }),
      );
      expect(result).toMatchObject({ revenue: '0', emailedAdmins: 2 });
    });
  });
});
