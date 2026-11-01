import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { JOBS, QUEUE_JOB_OPTIONS, QUEUES } from './queues';

/**
 * Đăng ký các tác vụ chạy theo lịch khi worker khởi động (F05.4).
 * `upsertJobScheduler` = tạo mới hoặc cập nhật theo id → khởi động lại worker
 * hay chạy nhiều worker cũng KHÔNG tạo lịch trùng.
 */
@Injectable()
export class JobSchedules implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobSchedules.name);

  constructor(
    @InjectQueue(QUEUES.SCHEDULED) private readonly scheduled: Queue,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const cron = this.config.get<string>('DAILY_REPORT_CRON', '0 23 * * *');
    await this.scheduled.upsertJobScheduler(
      'daily-revenue-report',
      { pattern: cron, tz: 'Asia/Ho_Chi_Minh' },
      {
        name: JOBS.DAILY_REVENUE_REPORT,
        data: {},
        opts: QUEUE_JOB_OPTIONS[QUEUES.SCHEDULED],
      },
    );
    // Lưới an toàn cho transactional outbox: mỗi phút đẩy lại sự kiện bị sót.
    await this.scheduled.upsertJobScheduler(
      'outbox-sweep',
      { every: 60_000 },
      {
        name: JOBS.OUTBOX_SWEEP,
        data: {},
        opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      },
    );
    this.logger.log(
      `Đã đăng ký lịch: báo cáo doanh thu "${cron}" (giờ VN), quét outbox mỗi 60 giây`,
    );
  }
}
