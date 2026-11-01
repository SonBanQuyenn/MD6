import { Processor } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { FailedJobsRepository } from '../failed-jobs.repository';
import { OutboxDispatcher } from '../outbox.dispatcher';
import {
  DailyReportJobData,
  InventorySyncJobData,
  JOBS,
  OrderJobData,
  QUEUES,
} from '../queues';
import { InventorySyncService } from '../services/inventory-sync.service';
import { InvoiceService } from '../services/invoice.service';
import { OrderNotificationsService } from '../services/order-notifications.service';
import { RevenueReportService } from '../services/revenue-report.service';
import { BaseProcessor } from './base.processor';

/**
 * Processor = phần xử lý job trong tiến trình worker.
 * Processor chỉ ĐIỀU PHỐI: đọc job.name → gọi service tương ứng. Logic nằm ở service.
 * `concurrency`: số job của hàng đợi đó được chạy song song trong 1 worker.
 */

@Processor(QUEUES.EMAIL, { concurrency: 5 })
export class EmailProcessor extends BaseProcessor {
  constructor(
    failedJobs: FailedJobsRepository,
    private readonly notifications: OrderNotificationsService,
  ) {
    super(failedJobs);
  }

  process(job: Job<OrderJobData>) {
    switch (job.name) {
      case JOBS.ORDER_CONFIRMATION:
        return this.notifications.sendOrderConfirmation(job.data.orderId);
      case JOBS.PAYMENT_REMINDER:
        return this.notifications.sendPaymentReminder(job.data.orderId);
      default:
        throw new UnrecoverableError(`Job email không hỗ trợ: ${job.name}`);
    }
  }
}

@Processor(QUEUES.INVOICE, { concurrency: 2 })
export class InvoiceProcessor extends BaseProcessor {
  constructor(
    failedJobs: FailedJobsRepository,
    private readonly invoices: InvoiceService,
  ) {
    super(failedJobs);
  }

  process(job: Job<OrderJobData>) {
    return this.invoices.generate(job.data.orderId);
  }
}

@Processor(QUEUES.INVENTORY_SYNC, { concurrency: 2 })
export class InventorySyncProcessor extends BaseProcessor {
  constructor(
    failedJobs: FailedJobsRepository,
    private readonly sync: InventorySyncService,
  ) {
    super(failedJobs);
  }

  process(job: Job<InventorySyncJobData>) {
    return this.sync.sync(job.data);
  }
}

@Processor(QUEUES.SCHEDULED, { concurrency: 1 })
export class ScheduledProcessor extends BaseProcessor {
  constructor(
    failedJobs: FailedJobsRepository,
    private readonly reports: RevenueReportService,
    private readonly outbox: OutboxDispatcher,
  ) {
    super(failedJobs);
  }

  process(job: Job<DailyReportJobData>) {
    switch (job.name) {
      case JOBS.DAILY_REVENUE_REPORT:
        return this.reports.generate(job.data?.date);
      case JOBS.OUTBOX_SWEEP:
        return this.outbox.dispatchStale();
      default:
        throw new UnrecoverableError(`Job định kỳ không hỗ trợ: ${job.name}`);
    }
  }
}
