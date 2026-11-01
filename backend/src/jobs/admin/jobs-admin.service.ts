import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { FailedJob } from '@prisma/client';
import { Queue } from 'bullmq';
import { Paginated } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { FailedJobsRepository } from '../failed-jobs.repository';
import { OutboxRepository } from '../outbox.repository';
import { JOBS, QUEUE_JOB_OPTIONS, QueueName, QUEUES } from '../queues';
import { vnDayRange, vnToday } from '../services/revenue-report.service';

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

@Injectable()
export class JobsAdminService {
  private readonly queues: Record<QueueName, Queue>;

  constructor(
    @InjectQueue(QUEUES.EMAIL) email: Queue,
    @InjectQueue(QUEUES.INVOICE) invoice: Queue,
    @InjectQueue(QUEUES.INVENTORY_SYNC) inventorySync: Queue,
    @InjectQueue(QUEUES.SCHEDULED) scheduled: Queue,
    private readonly failedJobs: FailedJobsRepository,
    private readonly outbox: OutboxRepository,
    private readonly prisma: PrismaService,
  ) {
    this.queues = {
      [QUEUES.EMAIL]: email,
      [QUEUES.INVOICE]: invoice,
      [QUEUES.INVENTORY_SYNC]: inventorySync,
      [QUEUES.SCHEDULED]: scheduled,
    };
  }

  /** Số job theo trạng thái của từng hàng đợi (F07.2). */
  async stats(): Promise<{ queues: QueueStats[]; outboxPending: number }> {
    const queues = await Promise.all(
      Object.entries(this.queues).map(async ([name, queue]) => {
        const c = await queue.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed',
          'paused',
        );
        return {
          name,
          waiting: c.waiting ?? 0,
          active: c.active ?? 0,
          completed: c.completed ?? 0,
          failed: c.failed ?? 0,
          delayed: c.delayed ?? 0,
          paused: c.paused ?? 0,
        };
      }),
    );
    return { queues, outboxPending: await this.outbox.countPending() };
  }

  async listFailed(params: {
    queue?: string;
    page: number;
    limit: number;
  }): Promise<Paginated<FailedJob>> {
    const { items, total } = await this.failedJobs.findMany({
      queue: params.queue,
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    });
    return {
      items,
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit),
    };
  }

  /**
   * Chạy lại một job đã vào dead letter. An toàn kể cả khi bấm nhiều lần,
   * vì mọi tác vụ đều idempotent ở tầng DB (dedupeKey / UNIQUE).
   */
  async retryFailed(id: string): Promise<{ queue: string; jobId: string }> {
    const record = await this.failedJobs.findById(id);
    if (!record) throw new NotFoundException('Không tìm thấy job lỗi');
    const queue = this.queues[record.queue as QueueName];
    if (!queue)
      throw new NotFoundException(`Hàng đợi ${record.queue} không tồn tại`);

    const existing = await queue.getJob(record.jobId);
    let jobId = record.jobId;
    if (existing && (await existing.isFailed())) {
      await existing.retry('failed');
    } else {
      // Job gốc đã bị dọn khỏi Redis → thêm job mới với id riêng cho lần chạy lại.
      jobId = `${record.jobId}-retry-${Date.now()}`;
      await queue.add(record.jobName, record.payload, {
        ...QUEUE_JOB_OPTIONS[record.queue as QueueName],
        jobId,
      });
    }
    await this.failedJobs.markRetried(id);
    return { queue: record.queue, jobId };
  }

  /** Kích hoạt báo cáo doanh thu ngay (demo / chạy bù), không cần chờ 23:00. */
  async triggerDailyReport(date = vnToday()): Promise<{ jobId: string }> {
    vnDayRange(date); // kiểm tra định dạng ngày → 400 nếu sai
    const jobId = `daily-revenue-report-manual-${date}-${Date.now()}`;
    await this.queues[QUEUES.SCHEDULED].add(
      JOBS.DAILY_REVENUE_REPORT,
      { date },
      { ...QUEUE_JOB_OPTIONS[QUEUES.SCHEDULED], jobId },
    );
    return { jobId };
  }

  async listReports(limit = 30) {
    const reports = await this.prisma.dailyRevenueReport.findMany({
      orderBy: { reportDate: 'desc' },
      take: limit,
    });
    return reports.map((r) => ({
      date: r.reportDate.toISOString().slice(0, 10),
      orderCount: r.orderCount,
      cancelledCount: r.cancelledCount,
      // BigInt không chuyển thẳng sang JSON được → trả dạng chuỗi
      revenue: r.revenue.toString(),
      breakdown: r.breakdown,
      updatedAt: r.updatedAt,
    }));
  }
}
