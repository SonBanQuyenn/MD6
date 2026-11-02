import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { FailedJobsRepository } from '../failed-jobs.repository';
import { OutboxRepository } from '../outbox.repository';
import { JobsAdminService } from './jobs-admin.service';

function makeQueue(counts: Record<string, number> = {}) {
  return {
    getJobCounts: jest.fn().mockResolvedValue(counts),
    getJob: jest.fn(),
    add: jest.fn(),
  };
}

describe('JobsAdminService', () => {
  let queues: Record<string, ReturnType<typeof makeQueue>>;
  let failedJobs: {
    findMany: jest.Mock;
    findById: jest.Mock;
    markRetried: jest.Mock;
  };
  let prisma: { dailyRevenueReport: { findMany: jest.Mock } };
  let service: JobsAdminService;

  beforeEach(() => {
    queues = {
      email: makeQueue({ waiting: 2, active: 1, completed: 10, failed: 1 }),
      invoice: makeQueue(),
      sync: makeQueue(),
      scheduled: makeQueue(),
      support: makeQueue({ delayed: 3 }),
    };
    failedJobs = {
      findMany: jest
        .fn()
        .mockResolvedValue({ items: [{ id: 'f1' }], total: 21 }),
      findById: jest.fn(),
      markRetried: jest.fn(),
    };
    prisma = { dailyRevenueReport: { findMany: jest.fn() } };
    service = new JobsAdminService(
      queues.email as unknown as Queue,
      queues.invoice as unknown as Queue,
      queues.sync as unknown as Queue,
      queues.scheduled as unknown as Queue,
      queues.support as unknown as Queue,
      failedJobs as unknown as FailedJobsRepository,
      {
        countPending: jest.fn().mockResolvedValue(4),
      } as unknown as OutboxRepository,
      prisma as unknown as PrismaService,
    );
  });

  it('stats: số job theo trạng thái của từng hàng đợi + outbox chưa đẩy (F07.2)', async () => {
    const stats = await service.stats();
    expect(stats.outboxPending).toBe(4);
    expect(stats.queues).toHaveLength(5);
    expect(stats.queues.find((q) => q.name === 'email')).toEqual({
      name: 'email',
      waiting: 2,
      active: 1,
      completed: 10,
      failed: 1,
      delayed: 0,
      paused: 0,
    });
    expect(stats.queues.find((q) => q.name === 'support')?.delayed).toBe(3);
  });

  it('listFailed: phân trang dead letter', async () => {
    const page = await service.listFailed({ page: 2, limit: 10 });
    expect(failedJobs.findMany).toHaveBeenCalledWith({
      queue: undefined,
      skip: 10,
      take: 10,
    });
    expect(page).toMatchObject({ page: 2, total: 21, totalPages: 3 });
  });

  it('retryFailed: job còn trong Redis ở trạng thái failed → retry tại chỗ', async () => {
    const job = {
      isFailed: jest.fn().mockResolvedValue(true),
      retry: jest.fn(),
    };
    failedJobs.findById.mockResolvedValue({
      id: 'f1',
      queue: 'email',
      jobId: 'order-confirmation-o1',
      jobName: 'order-confirmation',
      payload: { orderId: 'o1' },
    });
    queues.email.getJob.mockResolvedValue(job);
    await expect(service.retryFailed('f1')).resolves.toEqual({
      queue: 'email',
      jobId: 'order-confirmation-o1',
    });
    expect(job.retry).toHaveBeenCalledWith('failed');
    expect(failedJobs.markRetried).toHaveBeenCalledWith('f1');
  });

  it('retryFailed: job đã bị dọn khỏi Redis → thêm job mới với id riêng', async () => {
    failedJobs.findById.mockResolvedValue({
      id: 'f1',
      queue: 'email',
      jobId: 'order-confirmation-o1',
      jobName: 'order-confirmation',
      payload: { orderId: 'o1' },
    });
    queues.email.getJob.mockResolvedValue(undefined);
    const result = await service.retryFailed('f1');
    expect(result.jobId).toMatch(/^order-confirmation-o1-retry-\d+$/);
    expect(queues.email.add).toHaveBeenCalledWith(
      'order-confirmation',
      { orderId: 'o1' },
      expect.objectContaining({ jobId: result.jobId }),
    );
  });

  it('retryFailed: không tìm thấy bản ghi / hàng đợi lạ → 404', async () => {
    failedJobs.findById.mockResolvedValue(null);
    await expect(service.retryFailed('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    failedJobs.findById.mockResolvedValue({ id: 'x', queue: 'khong-co' });
    await expect(service.retryFailed('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('triggerDailyReport: thêm job vào hàng đợi định kỳ; ngày sai định dạng → 400', async () => {
    const { jobId } = await service.triggerDailyReport('2026-11-01');
    expect(jobId).toMatch(/^daily-revenue-report-manual-2026-11-01-/);
    expect(queues.scheduled.add).toHaveBeenCalled();
    await expect(
      service.triggerDailyReport('01/11/2026'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('listReports: doanh thu BigInt trả về dạng chuỗi (JSON không hỗ trợ BigInt)', async () => {
    prisma.dailyRevenueReport.findMany.mockResolvedValue([
      {
        reportDate: new Date('2026-11-01T00:00:00Z'),
        orderCount: 3,
        cancelledCount: 1,
        revenue: BigInt('12000000000'),
        breakdown: {},
        updatedAt: new Date(),
      },
    ]);
    const [report] = await service.listReports();
    expect(report).toMatchObject({
      date: '2026-11-01',
      revenue: '12000000000',
    });
  });
});
