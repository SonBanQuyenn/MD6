import { WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Job } from 'bullmq';
import { FailedJobsRepository } from '../failed-jobs.repository';

/**
 * Lần thất bại này có phải lần CUỐI không?
 *  - Đã dùng hết số lần thử (attemptsMade >= attempts), hoặc
 *  - Lỗi "không thể phục hồi" (UnrecoverableError) → BullMQ dừng luôn, không retry.
 */
export function isFinalFailure(job: Job, error: Error): boolean {
  if (error.name === 'UnrecoverableError') return true;
  return job.attemptsMade >= (job.opts.attempts ?? 1);
}

/**
 * Lớp cha cho mọi processor: khi một job thất bại LẦN CUỐI, lưu nó vào bảng
 * failed_jobs (dead letter) kèm lý do để admin xem và chạy lại (yêu cầu F05.2).
 */
export abstract class BaseProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  protected readonly logger = new Logger(this.constructor.name);

  constructor(private readonly failedJobs: FailedJobsRepository) {
    super();
  }

  onApplicationBootstrap(): void {
    this.worker.on('failed', (job, error) => {
      if (job) void this.handleFailed(job, error);
    });
  }

  async handleFailed(job: Job, error: Error): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    if (!isFinalFailure(job, error)) {
      this.logger.warn(
        `Job ${job.name} (${job.id}) lỗi lần ${job.attemptsMade}/${attempts}: ${error.message} — sẽ thử lại`,
      );
      return;
    }
    this.logger.error(
      `Job ${job.name} (${job.id}) THẤT BẠI sau ${job.attemptsMade} lần: ${error.message} → chuyển vào failed_jobs`,
    );
    try {
      await this.failedJobs.record({
        queue: job.queueName,
        jobId: job.id ?? 'unknown',
        jobName: job.name,
        payload: (job.data ?? {}) as Prisma.InputJsonValue,
        failedReason: error.message,
        stacktrace: error.stack,
        attemptsMade: job.attemptsMade,
      });
    } catch (recordError) {
      this.logger.error(`Không lưu được failed job: ${String(recordError)}`);
    }
  }
}
